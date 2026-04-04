/**
 * Shared function-resolution engine used by TreeBuilder and the function pool compiler.
 */

function createNoopLogger() {
  const noop = () => {};
  return {
    error: noop,
    warn: noop,
    debug: noop
  };
}

class FunctionResolutionEngine {
  constructor(options = {}) {
    const {
      defs = new Map(),
      asyncResolver = null,
      topicPublishResolver = null,
      logDecider = null,
      unresolvedSeverity = 'warning',
      logger = createNoopLogger()
    } = options;

    this.functionDefs = this._normalizeFunctionDefs(defs);
    this.resolvedFunctions = new Map();
    this.inFlightResolutions = new Map();
    this.asyncResolver = asyncResolver;
    this.topicPublishResolver = topicPublishResolver;
    this.logDecider = logDecider;
    this.unresolvedSeverity = unresolvedSeverity;
    this.logger = logger;
  }

  _normalizeFunctionDefs(defs) {
    const normalizedDefs = new Map();
    const entries = defs instanceof Map ? defs.entries() : Object.entries(defs || {});

    for (const [name, def = {}] of entries) {
      const { children, ...props } = def;
      const normalizedName = this._normalizeName(name);
      const propsWithDisplayName = props.displayName ? props : { displayName: name, ...props };
      normalizedDefs.set(normalizedName, {
        children: children || [],
        ...propsWithDisplayName
      });
    }

    return normalizedDefs;
  }

  _normalizeName(name) {
    return name?.toLowerCase();
  }

  _getFunctionDefs() {
    return this.functionDefs;
  }

  _getDisplayName(name) {
    const normalizedName = this._normalizeName(name);
    const def = this._getFunctionDefs().get(normalizedName);
    return def?.displayName || name;
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
      type: this.unresolvedSeverity,
      _unresolvedRef: name
    };
  }

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

  _createFunctionNodeContext(name, visited, path) {
    const normalizedName = this._normalizeName(name);

    if (visited.has(normalizedName)) {
      const displayName = this._getDisplayName(name);
      return { earlyResult: this._createCycleStopper(displayName, path) };
    }

    const def = this._getFunctionDefs().get(normalizedName);
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

  async _resolveAndCacheFunction(name, visited, path) {
    const normalizedName = this._normalizeName(name);
    const cacheKey = this._getFunctionCacheKey(normalizedName, visited);

    if (visited.has(normalizedName)) {
      const displayName = this._getDisplayName(name);
      return this._createCycleStopper(displayName, path);
    }

    if (this.resolvedFunctions.has(cacheKey)) {
      return this.resolvedFunctions.get(cacheKey);
    }

    if (this.inFlightResolutions.has(cacheKey)) {
      return await this.inFlightResolutions.get(cacheKey);
    }

    if (!this._getFunctionDefs().has(normalizedName)) {
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

  async _resolveChild(child, visited, path) {
    if (child.ref && !child.async && !child.topicPublish) {
      return this._resolveAndCacheFunction(child.ref, visited, path);
    }

    if (child.ref && child.async) {
      const { ref, async: _, queueName, asyncRef: _a, syncRef: _s, topicRef: _t, ...existingProps } = child;
      const normalizedRef = this._normalizeName(ref);
      const funcDef = this._getFunctionDefs().get(normalizedRef);
      const funcQueueName = funcDef?.queueName;
      const displayName = this._getDisplayName(ref);

      const effectiveQueueName = queueName || funcQueueName;
      const { resolvedProps, errorMetadataLines } = await this._resolveExternalProps(
        this.asyncResolver,
        'asyncResolver',
        [ref, effectiveQueueName]
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
        children: [await this._resolveAndCacheFunction(ref, visited, path)]
      }, {}, { resolvedProps, resolverName: 'asyncResolver' });
    }

    if (child.topicPublish) {
      const { ref, topicName, topicPublish: _, queueName, ...existingProps } = child;
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
        ...(metadataLines ? { metadata_lines: metadataLines } : {})
      }, {}, { resolvedProps, resolverName: 'topicPublishResolver' });
    }

    if (child.type === 'queue' || child.type === 'timer' || child.type === 'topic') {
      const childNodes = child.children || [];
      return this._applyLogMetadataLine({
        ...child,
        children: await Promise.all(childNodes.map(c => this._resolveChild(c, visited, path)))
      }, {}, {});
    }

    return child;
  }

  async _preResolveAllFunctions() {
    const emptyVisited = new Set();
    for (const name of this._getFunctionDefs().keys()) {
      const cacheKey = this._getFunctionCacheKey(name, emptyVisited);
      if (!this.resolvedFunctions.has(cacheKey)) {
        await this._resolveAndCacheFunction(name, emptyVisited, []);
      }
    }
  }

  async _resolveFunctionShallow(name, visited, path) {
    return await this._resolveFunctionByMode(name, visited, path, 'shallow');
  }

  async _resolveChildAsLeafOrLoadable(child, visited, path) {
    if (child.ref && !child.async && !child.topicPublish) {
      return this._resolveFunctionAsLeafOrLoadable(child.ref, visited, path);
    }

    if (child.ref && child.async) {
      const { ref: refName, async: _, queueName, asyncRef: _a, syncRef: _s, topicRef: _t, ...existingProps } = child;

      const normalizedRef = this._normalizeName(refName);
      const funcDef = this._getFunctionDefs().get(normalizedRef);
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
        ...(metadataLines ? { metadata_lines: metadataLines } : {})
      }, {}, { resolvedProps, resolverName: 'topicPublishResolver' });
    }

    if (child.type === 'queue' || child.type === 'timer' || child.type === 'topic') {
      const childNodes = child.children || [];
      return this._applyLogMetadataLine({
        ...child,
        children: await Promise.all(childNodes.map(c => this._resolveChildAsLeafOrLoadable(c, visited, path)))
      }, {}, {});
    }

    return child;
  }

  async _resolveFunctionAsLeafOrLoadable(name, visited, path) {
    return await this._resolveFunctionByMode(name, visited, path, 'leaf-or-loadable');
  }
}

export { FunctionResolutionEngine, createNoopLogger };
