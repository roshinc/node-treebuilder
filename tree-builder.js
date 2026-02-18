/**
 * Tree Builder Utility
 */
const DEFAULT_LOG_LEVEL = process.env.TREE_BUILDER_LOG_LEVEL || 'error';
const LOG_LEVELS = { error: 0, warn: 1, debug: 2 };

class TreeBuilder {
  constructor(config = {}) {
    const {
      unresolvedSeverity = 'warning',
      filterEmptyUiServiceMethods = false,
      filterEmptyUiServices = false,
      logNodeTypes = null,
      logger,
      logLevel = DEFAULT_LOG_LEVEL
    } = config;

    this.functionDefs = new Map();      // registry of function definitions
    this.resolvedFunctions = new Map(); // cache of resolved function subtrees
    this.inFlightResolutions = new Map(); // tracks promises for in-flight async function resolutions keyed by function and visited context, allowing concurrent callers to share the same promise and avoid duplicate work
    this.asyncResolver = null; // resolver to get the queue stats
    this.topicPublishResolver = null;
    this.logger = logger || TreeBuilder.createDefaultLogger({ level: logLevel });
    // Config with defaults
    this.config = {
      unresolvedSeverity, // 'error' or 'warning'
      filterEmptyUiServiceMethods, // omit ui-service-methods with no children
      filterEmptyUiServices, // omit ui-services with no children (after filtering methods)
      logNodeTypes // e.g., ['function', 'timer'] - node types that get a "Logs" metadata_line
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
    this._log('debug', 'Completed tree build', {
      resolvedFunctionContexts: this.resolvedFunctions.size
    });
    return tree;
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
      type: 'dupe-stopper',
      _cycleAt: displayName,
      _path: [...path, displayName]
    };
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

    const def = this.functionDefs.get(normalizedName);
    if (!def) {
      // Undefined function becomes error/warning node
      this._log('warn', 'Unresolved function reference', { ref: name });
      const unresolvedNode = {
        name: `dependency to ${name} could not be resolved so the tree may be incomplete`,
        type: this.config.unresolvedSeverity,
        _unresolvedRef: name
      };
      this.resolvedFunctions.set(cacheKey, unresolvedNode);
      return unresolvedNode;
    }

    const resolvePromise = (async () => {
      // Use displayName from definition for output
      const { children, app, queueName, displayName, ...props } = def;
      const outputName = displayName || name;

      const newVisited = new Set(visited);
      newVisited.add(normalizedName);
      const newPath = [...path, outputName];

      // Transform 'app' field into a metadata_line entry
      // Note: queueName is extracted but not included in output - it's used for async refs to this function
      let finalProps = { ...props };
      if (app) {
        const appMetadataLine = { text: app, clickable: false };
        finalProps.metadata_lines = [
          appMetadataLine,
          ...(props.metadata_lines || [])
        ];
      }

      // Create node (use displayName for the output name)
      const resolved = {
        name: outputName,
        type: 'function',
        ...finalProps
      };

      // Resolve children
      if (children && children.length > 0) {
        resolved.children = await Promise.all(
          children.map(child => this._resolveChild(child, newVisited, newPath))
        );
      }

      // Apply "Logs" metadata_line if this node type is configured for it
      const finalResolved = this._applyLogMetadataLine(resolved, app ? { app } : {});
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
      const { ref, async: _, queueName, ...existingProps } = child;

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
      });
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
      });
    }

    // Inline queue
    if (child.type === 'queue' || child.type === 'timer' || child.type === 'topic') {
      return this._applyLogMetadataLine({
        ...child,
        children: await Promise.all(child.children?.map(c => this._resolveChild(c, visited, path))) || []
      });
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
      const { ref, async: _, queueName, ...queueProps } = node;

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
      });
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
      });
    }

    // Copy node
    const result = { ...node };

    if (!node.children) return this._applyLogMetadataLine(result);

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

    return this._applyLogMetadataLine(result);
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
   * if its type is in the configured logNodeTypes list.
   * Returns a new object (to avoid cache mutation), or the original if no modification needed.
   * @param {object} node - The node to potentially modify
   * @param {object} extraData - Additional data to include in the log metadata (e.g., { app })
   */
  _applyLogMetadataLine(node, extraData = {}) {
    if (!node || !this.config.logNodeTypes || !this.config.logNodeTypes.includes(node.type)) {
      return node;
    }
    const logData = { name: node.name, type: node.type, ...extraData };
    const logMetadataLine = { text: 'Logs', clickable: true, data: logData };
    return {
      ...node,
      metadata_lines: [logMetadataLine, ...(node.metadata_lines || [])]
    };
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

export { TreeBuilder, ref, asyncRef, topicPublishRef };
