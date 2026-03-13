/**
 * Tree Builder Utility
 */
const DEFAULT_LOG_LEVEL = process.env.TREE_BUILDER_LOG_LEVEL || 'error';
const LOG_LEVELS = { error: 0, warn: 1, debug: 2 };

class LogDecider {
  constructor(nodeTypes = []) {
    this.nodeTypes = new Set(nodeTypes);
  }

  decide(node, { resolvedProps, resolverName } = {}) {
    return this.nodeTypes.has(node.type);
  }
}

class TreeBuilder {
  constructor(config = {}) {
    const {
      unresolvedSeverity = 'warning',
      filterEmptyUiServiceMethods = false,
      filterEmptyUiServices = false,
      showMinimal = false,
      logger,
      logLevel = DEFAULT_LOG_LEVEL
    } = config;

    this.functionDefs = new Map();      // registry of function definitions
    this.resolvedFunctions = new Map(); // cache of resolved function subtrees
    this.inFlightResolutions = new Map(); // tracks promises for in-flight async function resolutions keyed by function and visited context, allowing concurrent callers to share the same promise and avoid duplicate work
    this.asyncResolver = null; // resolver to get the queue stats
    this.topicPublishResolver = null;
    this.logDecider = null; // decides which nodes get a "Logs" metadata_line
    this.logger = logger || TreeBuilder.createDefaultLogger({ level: logLevel });
    // Config with defaults
    this.config = {
      unresolvedSeverity, // 'error' or 'warning'
      filterEmptyUiServiceMethods, // omit ui-service-methods with no children
      filterEmptyUiServices, // omit ui-services with no children (after filtering methods)
      showMinimal // collapse function nodes that cross app boundaries
    };
  }

  static createDefaultLogger({ level = DEFAULT_LOG_LEVEL } = {}) {
    const threshold = LOG_LEVELS[level] ?? LOG_LEVELS.error;
    const noop = () => {};
    return {
      error: threshold >= LOG_LEVELS.error
        ? (message, meta) => console.error(`[TreeBuilder] ${message}`, meta)
        : noop,
      warn: threshold >= LOG_LEVELS.warn
        ? (message, meta) => console.warn(`[TreeBuilder] ${message}`, meta)
        : noop,
      debug: threshold >= LOG_LEVELS.debug
        ? (message, meta) => console.debug(`[TreeBuilder] ${message}`, meta)
        : noop,
    };
  }

  setAsyncResolver(resolver) {
    this.asyncResolver = resolver;
    return this;
  }

  setTopicPublishResolver(resolver) {
    this.topicPublishResolver = resolver;
    return this;
  }

  setLogDecider(decider) {
    this.logDecider = decider;
    return this;
  }

  _createResolverErrorMetadataLines(resolverName, error) {
    const message = error instanceof Error ? error.message : String(error);
    return [{
      text: `${resolverName} errored out${message ? `: ${message}` : ''}`,
      clickable: false
    }];
  }

  _log(level, message, meta = {}) {
    const logFn = this.logger?.[level];
    if (typeof logFn === 'function') {
      logFn.call(this.logger, message, meta);
    }
  }

  async _resolveExternalProps(resolver, resolverName, args) {
    if (!resolver) {
      return { resolvedProps: {}, errorMetadataLines: [] };
    }

    try {
      const result = await resolver(...args);
      if (result === null || result === undefined) {
        return { resolvedProps: {}, errorMetadataLines: [] };
      }
      return { resolvedProps: result, errorMetadataLines: [] };
    } catch (error) {
      this._log('error', `${resolverName} failed`, { resolverName, args, error });
      return {
        resolvedProps: {},
        errorMetadataLines: this._createResolverErrorMetadataLines(resolverName, error)
      };
    }
  }

  _mergeMetadataLines(...lineGroups) {
    const merged = lineGroups.flat().filter(Boolean);
    return merged.length > 0 ? merged : undefined;
  }

  /**
   * Normalize a function name for case-insensitive lookup.
   */
  _normalizeName(name) {
    return name?.toLowerCase();
  }

  /**
   * Get the display name for a function.
   * Uses displayName from def if available, otherwise uses the provided name.
   */
  _getDisplayName(name) {
    const normalizedName = this._normalizeName(name);
    const def = this.functionDefs.get(normalizedName);
    return def?.displayName || name;
  }

  defineFunction(name, children = [], extraProps = {}) {
    const normalizedName = this._normalizeName(name);
    // Store with displayName if not already provided
    const propsWithDisplayName = extraProps.displayName ? extraProps : { displayName: name, ...extraProps };
    this.functionDefs.set(normalizedName, { children, ...propsWithDisplayName });
    return this;
  }

  defineFunctions(defs) {
    for (const [name, def] of Object.entries(defs)) {
      const { children, ...props } = def;
      const normalizedName = this._normalizeName(name);
      // Store with displayName if not already provided
      const propsWithDisplayName = props.displayName ? props : { displayName: name, ...props };
      this.functionDefs.set(normalizedName, {
        children: children || [],
        ...propsWithDisplayName
      });
    }
    return this;
  }

  async build(rootStructure) {
    this._log('debug', 'Starting tree build', {
      rootName: rootStructure?.name,
      definedFunctionCount: this.functionDefs.size
    });
    // Clear cache for fresh build
    this.resolvedFunctions.clear();
    this.inFlightResolutions.clear();
    // First pass: resolve all functions (builds cache)
    await this._preResolveAllFunctions();
    // Second pass: build tree using cached functions
    const tree = await this._buildNode(rootStructure);
    // Post-process: add collapsed hints for showMinimal mode
    const finalTree = this.config.showMinimal ? this._applyShowMinimal(tree, rootStructure.name?.toLowerCase()) : tree;
    this._log('debug', 'Completed tree build', {
      resolvedFunctionContexts: this.resolvedFunctions.size
    });
    return finalTree;
  }

  /**
   * Pre-resolve all defined functions to populate cache.
   * This ensures consistent subtrees everywhere.
   */
  async _preResolveAllFunctions() {
    const emptyVisited = new Set();
    for (const name of this.functionDefs.keys()) {
      const cacheKey = this._getFunctionCacheKey(name, emptyVisited);
      if (!this.resolvedFunctions.has(cacheKey)) {
        await this._resolveAndCacheFunction(name, emptyVisited, []);
      }
    }
  }

  _getFunctionCacheKey(name, visited = new Set()) {
    const normalizedName = this._normalizeName(name);
    const visitedKey = [...visited].sort().join('|');
    return `${normalizedName}::${visitedKey}`;
  }

  _createCycleStopper(displayName, path) {
    return {
      name: `loop detected stopping (${displayName})`,
      type: 'loop',
      _cycleAt: displayName,
      _path: [...path, displayName]
    };
  }

  _createUnresolvedNode(name) {
    this._log('warn', 'Unresolved function reference', { ref: name });
    return {
      name: `dependency to ${name} could not be resolved so the tree may be incomplete`,
      type: this.config.unresolvedSeverity,
      _unresolvedRef: name
    };
  }

  _createFunctionNodeContext(name, visited, path) {
    const normalizedName = this._normalizeName(name);

    if (visited.has(normalizedName)) {
      const displayName = this._getDisplayName(name);
      return { earlyResult: this._createCycleStopper(displayName, path) };
    }

    const def = this.functionDefs.get(normalizedName);
    if (!def) {
      return { earlyResult: this._createUnresolvedNode(name) };
    }
    const { children, app, queueName, displayName, usesLegacyGatewayHttpClient, ctg, ...props } = def;
    const outputName = displayName || name;
    const nextVisited = new Set(visited);
    nextVisited.add(normalizedName);
    const nextPath = [...path, outputName];

    let finalProps = { ...props };
    if (app) {
      const appMetadataLine = { text: app, clickable: false };
      finalProps.metadata_lines = [
        appMetadataLine,
        ...(props.metadata_lines || [])
      ];
    }

    const resolved = {
      name: outputName,
      type: ctg === true ? 'ctg' : 'function',
      ...finalProps
    };
    if (app) resolved.app = app;

    return {
      children,
      usesLegacyGatewayHttpClient,
      isCtg: ctg === true,
      resolved,
      nextVisited,
      nextPath,
      logExtraData: app ? { app } : {}
    };
  }

  _finalizeFunctionNode(context, resolved) {
    return this._applyLogMetadataLine(resolved, context.logExtraData, {});
  }

  async _resolveFunctionByMode(name, visited, path, mode) {
    const context = this._createFunctionNodeContext(name, visited, path);
    if (context.earlyResult) {
      return context.earlyResult;
    }

    const {
      children,
      usesLegacyGatewayHttpClient,
      isCtg,
      resolved,
      nextVisited,
      nextPath
    } = context;

    if (isCtg) {
      return this._finalizeFunctionNode(context, resolved);
    }

    const hasChildren = children && children.length > 0;
    if (mode === 'full' && hasChildren) {
      resolved.children = await Promise.all(
        children.map(child => this._resolveChild(child, nextVisited, nextPath))
      );
    } else if (mode === 'shallow' && hasChildren) {
      resolved.children = await Promise.all(
        children.map(child => this._resolveChildAsLeafOrLoadable(child, nextVisited, nextPath))
      );
    } else if (mode === 'leaf-or-loadable' && hasChildren) {
      resolved.loadChildren = true;
    }

    const shouldAppendSmartChild = usesLegacyGatewayHttpClient === true
      && (mode !== 'leaf-or-loadable' || !hasChildren);
    if (shouldAppendSmartChild) {
      if (!resolved.children) resolved.children = [];
      resolved.children.push({ name: 'SMART Call Over HTTPS', type: 'smart' });
    }

    return this._finalizeFunctionNode(context, resolved);
  }

  /**
   * Resolve a function and cache it.
   * Cycle detection is path-based during this phase.
   * Uses normalized (lowercase) names for lookups and cache keys.
   */
  async _resolveAndCacheFunction(name, visited, path) {
    // Normalize for case-insensitive lookup
    const normalizedName = this._normalizeName(name);
    const cacheKey = this._getFunctionCacheKey(normalizedName, visited);

    // Cycle detection (use normalized name)
    if (visited.has(normalizedName)) {
      const displayName = this._getDisplayName(name);
      return this._createCycleStopper(displayName, path);
    }

    // Already resolved for this path context?
    if (this.resolvedFunctions.has(cacheKey)) {
      return this.resolvedFunctions.get(cacheKey);
    }

    // If another branch is currently resolving the same path context, await it.
    if (this.inFlightResolutions.has(cacheKey)) {
      return await this.inFlightResolutions.get(cacheKey);
    }

    if (!this.functionDefs.has(normalizedName)) {
      const unresolvedNode = this._createUnresolvedNode(name);
      this.resolvedFunctions.set(cacheKey, unresolvedNode);
      return unresolvedNode;
    }

    const resolvePromise = (async () => {
      const finalResolved = await this._resolveFunctionByMode(name, visited, path, 'full');
      this.resolvedFunctions.set(cacheKey, finalResolved);
      return finalResolved;
    })();

    this.inFlightResolutions.set(cacheKey, resolvePromise);
    try {
      return await resolvePromise;
    } finally {
      this.inFlightResolutions.delete(cacheKey);
    }
  }

  /**
   * Resolve a child node during pre-resolution phase.
   */
  async _resolveChild(child, visited, path) {
    // Sync reference
    if (child.ref && !child.async && !child.topicPublish) {
      return this._resolveAndCacheFunction(child.ref, visited, path);
    }

    // Async reference = queue wrapper
    if (child.ref && child.async) {
      const { ref, async: _, queueName, asyncRef: _a, syncRef: _s, topicRef: _t, ...existingProps } = child;

      // Look up the function definition's queueName (default queue for async refs to this function)
      // Use normalized name for case-insensitive lookup
      const normalizedRef = this._normalizeName(ref);
      const funcDef = this.functionDefs.get(normalizedRef);
      const funcQueueName = funcDef?.queueName;
      const displayName = this._getDisplayName(ref);

      // Pass the effective queueName to resolver: ref's queueName > function's queueName
      const effectiveQueueName = queueName || funcQueueName;
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.asyncResolver,
        'asyncResolver',
        [ref, effectiveQueueName]
      );

      // Priority: resolver > ref's queueName > function's queueName > default (use displayName for default)
      const finalQueueName = resolvedProps.queueName || queueName || funcQueueName || `${displayName}_queue`;
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        existingProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'timer', //'queue',
        ...existingProps,
        ...resolvedProps,
        queueName: undefined, // clean up, name is already set
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
        children: [await this._resolveAndCacheFunction(ref, visited, path)]
      }, {}, { resolvedProps, resolverName: 'asyncResolver' });
    }

    // Topic Publish reference = queue wrapper
    if (child.topicPublish) {
      const { ref, topicName, topicPublish: _, queueName, ...existingProps } = child;
      const effectiveTopicName = topicName || 'unknown topic';
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.topicPublishResolver,
        'topicPublishResolver',
        [effectiveTopicName, queueName]
      );

      // Merge, resolver props override existing, but existing queueName is fallback
      const finalQueueName = resolvedProps.queueName
        || queueName
        || (topicName ? `${topicName}_queue` : 'unknown topic');
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        existingProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'topic', //'queue',
        ...existingProps,
        ...resolvedProps,
        queueName: undefined, // clean up, name is already set
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
        //children: [await this._resolveAndCacheFunction(ref, visited, path)]
      }, {}, { resolvedProps, resolverName: 'topicPublishResolver' });
    }

    // Inline queue
    if (child.type === 'queue' || child.type === 'timer' || child.type === 'topic') {
      const childNodes = child.children || [];
      return this._applyLogMetadataLine({
        ...child,
        children: await Promise.all(childNodes.map(c => this._resolveChild(c, visited, path)))
      }, {}, {});
    }

    // Other inline node (shouldn't happen in function defs, but handle it)
    return child;
  }

  /**
   * Build the final tree structure using cached functions.
   * This phase handles app structure, ui-services, ui-service-methods.
   */
  async _buildNode(node, visited = new Set(), path = []) {
    // Sync reference
    if (node.ref && !node.async && !node.topicPublish) {
      return await this._getFunctionWithCycleCheck(node.ref, visited, path);
    }

    // Async reference = queue wrapper
    if (node.ref && node.async) {
      const { ref, async: _, queueName, asyncRef: _a, syncRef: _s, topicRef: _t, ...queueProps } = node;

      // Look up the function definition's queueName (default queue for async refs to this function)
      // Use normalized name for case-insensitive lookup
      const normalizedRef = this._normalizeName(ref);
      const funcDef = this.functionDefs.get(normalizedRef);
      const funcQueueName = funcDef?.queueName;
      const displayName = this._getDisplayName(ref);

      // Pass the effective queueName to resolver: ref's queueName > function's queueName
      const effectiveQueueName = queueName || funcQueueName;
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.asyncResolver,
        'asyncResolver',
        [ref, effectiveQueueName]
      );

      // Priority: resolver > ref's queueName > function's queueName > default (use displayName for default)
      const finalQueueName = resolvedProps.queueName || queueName || funcQueueName || `${displayName}_queue`;
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        queueProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'timer',
        ...queueProps,
        ...resolvedProps,
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
        children: [await this._getFunctionWithCycleCheck(ref, visited, path)]
      }, {}, { resolvedProps, resolverName: 'asyncResolver' });
    }

    // Topic Publish reference = queue wrapper
    if (node.topicPublish) {
      const { ref, topicName, topicPublish: _, queueName, ...queueProps } = node;
      const effectiveTopicName = topicName || 'unknown topic';
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.topicPublishResolver,
        'topicPublishResolver',
        [effectiveTopicName, queueName]
      );

      const finalQueueName = resolvedProps.queueName
        || queueName
        || (topicName ? `${topicName}_queue` : 'unknown topic');
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        queueProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'topic',
        ...queueProps,
        ...resolvedProps,
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
        //children: [this._getFunctionWithCycleCheck(ref, visited, path)]
      }, {}, { resolvedProps, resolverName: 'topicPublishResolver' });
    }

    // Copy node, extracting usesLegacyGatewayHttpClient so it doesn't appear in output
    const { usesLegacyGatewayHttpClient, ctg, ...nodeWithoutFlag } = node;
    const result = { ...nodeWithoutFlag };

    if (!node.children) {
      if (usesLegacyGatewayHttpClient === true) {
        result.children = [{ name: 'SMART Call Over HTTPS', type: 'smart' }];
      }
      return this._applyLogMetadataLine(result, {}, {});
    }

    // Track path for ui-service-method and function types
    let newVisited = visited;
    let newPath = path;

    if (this._shouldTrack(node.type) && node.name) {
      const normalizedNodeName = this._normalizeName(node.name);
      if (visited.has(normalizedNodeName)) {
        return this._createCycleStopper(node.name, path);
      }
      newVisited = new Set(visited);
      newVisited.add(normalizedNodeName);
      newPath = [...path, node.name];
    }

    const resolvedChildren = await Promise.all(node.children.map(child =>
      this._buildNode(child, newVisited, newPath)
    ));
    // Filter out null children (nodes that were filtered out)
    result.children = resolvedChildren.filter(child => child !== null);

    // Append "SMART Call Over HTTPS" leaf if usesLegacyGatewayHttpClient is true
    if (usesLegacyGatewayHttpClient === true) {
      result.children.push({ name: 'SMART Call Over HTTPS', type: 'smart' });
    }

    // Filter empty ui-service-methods if configured
    if (this.config.filterEmptyUiServiceMethods && node.type === 'ui-services') {
      result.children = result.children.filter(child => {
        if (child.type === 'ui-service-method') {
          return child.children && child.children.length > 0;
        }
        return true;
      });
    }

    // Filter empty ui-services if configured (after filtering methods)
    if (this.config.filterEmptyUiServices && node.type === 'ui-services') {
      if (!result.children || result.children.length === 0) {
        return null; // Signal to parent to filter this node out
      }
    }

    return this._applyLogMetadataLine(result, {}, {});
  }

  /**
   * Get a function from cache, with cycle check for current path.
   * Uses normalized (lowercase) names for lookups.
   */
  async _getFunctionWithCycleCheck(name, visited, path) {
    // Normalize for case-insensitive lookup
    const normalizedName = this._normalizeName(name);
    const displayName = this._getDisplayName(name);

    if (visited.has(normalizedName)) {
      return this._createCycleStopper(displayName, path);
    }

    const cacheKey = this._getFunctionCacheKey(normalizedName, visited);
    const cached = this.resolvedFunctions.get(cacheKey);
    if (cached) {
      return cached;
    }

    return await this._resolveAndCacheFunction(name, visited, path);
  }

  /**
   * Only track functions for cycle detection.
   * - app, ui-services: structural containers, not tracked
   * - ui-service-method: only appears as direct child of ui-services, 
   *   can share names with functions, refs inside always point to functions
   * - queue: names can repeat
   */
  _shouldTrack(type) {
    return type === 'function';
  }

  /**
   * Conditionally prepend a "Logs" metadata_line to a node
   * if the configured LogDecider approves it.
   * Returns a new object (to avoid cache mutation), or the original if no modification needed.
   * @param {object} node - The node to potentially modify
   * @param {object} extraData - Additional data to include in the log metadata (e.g., { app })
   * @param {object} context - Resolver context passed to LogDecider.decide() (e.g., { resolvedProps, resolverName })
   */
  _applyLogMetadataLine(node, extraData = {}, context = {}) {
    if (!node || !this.logDecider || !this.logDecider.decide(node, context)) {
      return node;
    }
    const logData = { name: node.name, type: node.type, ...extraData };
    const logMetadataLine = { text: 'Logs', clickable: true, data: logData };
    return {
      ...node,
      metadata_lines: [logMetadataLine, ...(node.metadata_lines || [])]
    };
  }

  /**
   * Post-process a built tree to add collapsed: true hints for showMinimal mode.
   * Collapses function nodes once an app boundary is crossed (function.app differs
   * from rootAppName). Once crossed, all deeper nodes stay collapsed even if the
   * app name matches again.
   * Creates shallow copies only for nodes it modifies.
   * @param {object} node - The node to process
   * @param {string} rootAppName - The root app template's name
   * @param {boolean} crossedBoundary - Whether an app boundary has already been crossed
   */
  _applyShowMinimal(node, rootAppName, crossedBoundary = false) {
    if (!node) return node;

    // Check if this function node crosses the app boundary
    const nodeCrossesBoundary = node.type === 'function' &&
      (!node.app || node.app.toLowerCase() !== rootAppName);
    const isCrossed = crossedBoundary || nodeCrossesBoundary;

    let result = node;
    let modified = false;

    // Recurse into children first (bottom-up)
    if (node.children && node.children.length > 0) {
      const newChildren = node.children.map(child =>
        this._applyShowMinimal(child, rootAppName, isCrossed)
      );
      if (newChildren.some((c, i) => c !== node.children[i])) {
        result = { ...result, children: newChildren };
        modified = true;
      }
    }

    const hasChildren = result.children && result.children.length > 0;
    const shouldCollapse =
      node.type === 'function' && hasChildren && isCrossed;

    if (shouldCollapse) {
      if (!modified) result = { ...result };
      result.collapsed = true;
    }

    return result;
  }

  // ── Lazy-loading API ────────────────────────────────────────────────

  /**
   * Build a tree lazily from an app template.
   * Resolves the app structure and immediate function children,
   * but does NOT resolve grandchildren.  Functions whose definitions
   * include children get `loadChildren: true` instead.
   */
  async buildLazy(rootStructure) {
    this._log('debug', 'Starting lazy tree build', {
      rootName: rootStructure?.name
    });
    const tree = await this._buildNodeLazy(rootStructure, new Set(), []);
    this._log('debug', 'Completed lazy tree build');
    return tree;
  }

  /**
   * Build a tree lazily starting from a single function name.
   * Returns the function as root with its direct children resolved
   * shallowly (same depth-1 treatment as buildLazy).
   */
  async buildLazyFrom(functionName) {
    this._log('debug', 'Starting lazy build from function', { functionName });
    const result = await this._resolveFunctionShallow(functionName, new Set(), []);
    this._log('debug', 'Completed lazy build from function');
    return result;
  }

  /**
   * Mirrors _buildNode but resolves function refs shallowly (one level).
   * Structural containers (app, ui-services, ui-service-method) are
   * traversed transparently — only function ref boundaries count as depth.
   */
  async _buildNodeLazy(node, visited = new Set(), path = []) {
    // Sync reference → resolve function + its immediate children
    if (node.ref && !node.async && !node.topicPublish) {
      return await this._resolveFunctionShallow(node.ref, visited, path);
    }

    // Async reference → timer wrapper + inner function (shown together)
    if (node.ref && node.async) {
      const { ref: refName, async: _, queueName, asyncRef: _a, syncRef: _s, topicRef: _t, ...queueProps } = node;

      const normalizedRef = this._normalizeName(refName);
      const funcDef = this.functionDefs.get(normalizedRef);
      const funcQueueName = funcDef?.queueName;
      const displayName = this._getDisplayName(refName);

      const effectiveQueueName = queueName || funcQueueName;
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.asyncResolver,
        'asyncResolver',
        [refName, effectiveQueueName]
      );

      const finalQueueName = resolvedProps.queueName || queueName || funcQueueName || `${displayName}_queue`;
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        queueProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'timer',
        ...queueProps,
        ...resolvedProps,
        queueName: undefined,
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
        children: [await this._resolveFunctionShallow(refName, visited, path)]
      }, {}, { resolvedProps, resolverName: 'asyncResolver' });
    }

    // Topic publish → leaf node (identical to _buildNode)
    if (node.topicPublish) {
      const { ref: refName, topicName, topicPublish: _, queueName, ...queueProps } = node;
      const effectiveTopicName = topicName || 'unknown topic';
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.topicPublishResolver,
        'topicPublishResolver',
        [effectiveTopicName, queueName]
      );

      const finalQueueName = resolvedProps.queueName
        || queueName
        || (topicName ? `${topicName}_queue` : 'unknown topic');
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        queueProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'topic',
        ...queueProps,
        ...resolvedProps,
        queueName: undefined,
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
      }, {}, { resolvedProps, resolverName: 'topicPublishResolver' });
    }

    // Structural node (app, ui-services, ui-service-method, etc.)
    const { usesLegacyGatewayHttpClient, ctg, ...nodeWithoutFlag } = node;
    const result = { ...nodeWithoutFlag };

    if (!node.children) {
      if (usesLegacyGatewayHttpClient === true) {
        result.children = [{ name: 'SMART Call Over HTTPS', type: 'smart' }];
      }
      return this._applyLogMetadataLine(result, {}, {});
    }

    // Track path for function types
    let newVisited = visited;
    let newPath = path;
    if (this._shouldTrack(node.type) && node.name) {
      const normalizedNodeName = this._normalizeName(node.name);
      if (visited.has(normalizedNodeName)) {
        return this._createCycleStopper(node.name, path);
      }
      newVisited = new Set(visited);
      newVisited.add(normalizedNodeName);
      newPath = [...path, node.name];
    }

    const resolvedChildren = await Promise.all(node.children.map(child =>
      this._buildNodeLazy(child, newVisited, newPath)
    ));
    result.children = resolvedChildren.filter(child => child !== null);

    if (usesLegacyGatewayHttpClient === true) {
      result.children.push({ name: 'SMART Call Over HTTPS', type: 'smart' });
    }

    // Filtering (same as _buildNode)
    if (this.config.filterEmptyUiServiceMethods && node.type === 'ui-services') {
      result.children = result.children.filter(child => {
        if (child.type === 'ui-service-method') {
          return child.children && child.children.length > 0;
        }
        return true;
      });
    }
    if (this.config.filterEmptyUiServices && node.type === 'ui-services') {
      if (!result.children || result.children.length === 0) {
        return null;
      }
    }

    return this._applyLogMetadataLine(result, {}, {});
  }

  /**
   * Resolve a function AND its immediate children (one level deep).
   * Each child is resolved via _resolveChildAsLeafOrLoadable.
   */
  async _resolveFunctionShallow(name, visited, path) {
    return await this._resolveFunctionByMode(name, visited, path, 'shallow');
  }

  /**
   * Resolve a child reference to its node representation without
   * recursing into its children.  Sets loadChildren: true if the
   * underlying function has unresolved children.
   */
  async _resolveChildAsLeafOrLoadable(child, visited, path) {
    // Sync reference
    if (child.ref && !child.async && !child.topicPublish) {
      return this._resolveFunctionAsLeafOrLoadable(child.ref, visited, path);
    }

    // Async reference → timer wrapper + inner function as leaf-or-loadable
    if (child.ref && child.async) {
      const { ref: refName, async: _, queueName, asyncRef: _a, syncRef: _s, topicRef: _t, ...existingProps } = child;

      const normalizedRef = this._normalizeName(refName);
      const funcDef = this.functionDefs.get(normalizedRef);
      const funcQueueName = funcDef?.queueName;
      const displayName = this._getDisplayName(refName);

      const effectiveQueueName = queueName || funcQueueName;
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.asyncResolver,
        'asyncResolver',
        [refName, effectiveQueueName]
      );

      const finalQueueName = resolvedProps.queueName || queueName || funcQueueName || `${displayName}_queue`;
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        existingProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'timer',
        ...existingProps,
        ...resolvedProps,
        queueName: undefined,
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
        children: [await this._resolveFunctionAsLeafOrLoadable(refName, visited, path)]
      }, {}, { resolvedProps, resolverName: 'asyncResolver' });
    }

    // Topic publish → leaf node
    if (child.topicPublish) {
      const { ref: refName, topicName, topicPublish: _, queueName, ...existingProps } = child;
      const effectiveTopicName = topicName || 'unknown topic';
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.topicPublishResolver,
        'topicPublishResolver',
        [effectiveTopicName, queueName]
      );

      const finalQueueName = resolvedProps.queueName
        || queueName
        || (topicName ? `${topicName}_queue` : 'unknown topic');
      const metadataLines = this._mergeMetadataLines(
        errorMetadataLines,
        existingProps.metadata_lines,
        resolvedProps.metadata_lines
      );

      return this._applyLogMetadataLine({
        name: finalQueueName,
        type: 'topic',
        ...existingProps,
        ...resolvedProps,
        queueName: undefined,
        ...(metadataLines ? { metadata_lines: metadataLines } : {}),
      }, {}, { resolvedProps, resolverName: 'topicPublishResolver' });
    }

    // Inline queue/timer/topic → resolve wrapper, children as leaf-or-loadable
    if (child.type === 'queue' || child.type === 'timer' || child.type === 'topic') {
      const childNodes = child.children || [];
      return this._applyLogMetadataLine({
        ...child,
        children: await Promise.all(childNodes.map(c => this._resolveChildAsLeafOrLoadable(c, visited, path)))
      }, {}, {});
    }

    // Other inline node
    return child;
  }

  /**
   * Build a function node WITHOUT resolving its children.
   * Sets loadChildren: true if the function has children defined.
   * loadChildren and children are mutually exclusive.
   */
  async _resolveFunctionAsLeafOrLoadable(name, visited, path) {
    return await this._resolveFunctionByMode(name, visited, path, 'leaf-or-loadable');
  }

  static ref(name) {
    return { ref: name };
  }

  static asyncRef(name, queueName, props = {}) {
    return {
      ref: name,
      async: true,
      queueName,
      ...props
    };
  }

  static topicPublishRef(topicName, queueName, props = {}) {
    return {
      ref: undefined,
      topicName: topicName,
      topicPublish: true,
      async: false,
      queueName,
      ...props
    };
  }
}

const ref = TreeBuilder.ref;
const asyncRef = TreeBuilder.asyncRef;
const topicPublishRef = TreeBuilder.topicPublishRef;

export { TreeBuilder, LogDecider, ref, asyncRef, topicPublishRef };

