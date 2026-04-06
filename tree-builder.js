/**
 * Tree Builder Utility
 */
import { compileFunctionPool } from './function-pool-compiler.js';
import { FunctionResolutionEngine } from './function-resolution-engine.js';

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

class TreeBuilder extends FunctionResolutionEngine {
  constructor(config = {}) {
    const {
      unresolvedSeverity = 'warning',
      filterEmptyUiServiceMethods = false,
      filterEmptyUiServices = false,
      showMinimal = false,
      compiledPool = null,
      logger,
      logLevel = DEFAULT_LOG_LEVEL
    } = config;

    const resolvedLogger = logger || TreeBuilder.createDefaultLogger({ level: logLevel });
    super({
      defs: new Map(),
      unresolvedSeverity,
      logger: resolvedLogger
    });

    this.externalCompiledPool = compiledPool;
    this.internalCompiledPool = null;
    this.config = {
      unresolvedSeverity,
      filterEmptyUiServiceMethods,
      filterEmptyUiServices,
      showMinimal
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
    this._invalidateInternalCompiledPool();
    return this;
  }

  setTopicPublishResolver(resolver) {
    this.topicPublishResolver = resolver;
    this._invalidateInternalCompiledPool();
    return this;
  }

  setLogDecider(decider) {
    this.logDecider = decider;
    this._invalidateInternalCompiledPool();
    return this;
  }

  setCompiledPool(compiledPool) {
    this.externalCompiledPool = compiledPool;
    this._invalidateInternalCompiledPool();
    return this;
  }

  _invalidateInternalCompiledPool() {
    this.internalCompiledPool = null;
    this.resolvedFunctions.clear();
    this.inFlightResolutions.clear();
  }

  _getActiveCompiledPool() {
    return this.externalCompiledPool || this.internalCompiledPool;
  }

  _getFunctionDefs() {
    return this._getActiveCompiledPool()?.functionDefs || this.functionDefs;
  }

  _getCompileOptions() {
    return {
      asyncResolver: this.asyncResolver,
      topicPublishResolver: this.topicPublishResolver,
      logDecider: this.logDecider,
      unresolvedSeverity: this.config.unresolvedSeverity,
      logger: this.logger
    };
  }

  async _ensureCompiledPool() {
    if (this.externalCompiledPool) {
      return this.externalCompiledPool;
    }

    if (!this.internalCompiledPool) {
      this.internalCompiledPool = await compileFunctionPool(this.functionDefs, this._getCompileOptions());
    }

    return this.internalCompiledPool;
  }

  _assertNoExternalPool(methodName) {
    if (this.externalCompiledPool) {
      throw new Error(`Cannot call ${methodName}() while an external compiled pool is attached. Use setCompiledPool() to replace or clear it first.`);
    }
  }

  defineFunction(name, children = [], extraProps = {}) {
    this._assertNoExternalPool('defineFunction');
    const normalizedName = this._normalizeName(name);
    const propsWithDisplayName = extraProps.displayName ? extraProps : { displayName: name, ...extraProps };
    this.functionDefs.set(normalizedName, { children, ...propsWithDisplayName });
    this._invalidateInternalCompiledPool();
    return this;
  }

  defineFunctions(defs) {
    this._assertNoExternalPool('defineFunctions');
    for (const [name, def] of Object.entries(defs)) {
      const { children, ...props } = def;
      const normalizedName = this._normalizeName(name);
      const propsWithDisplayName = props.displayName ? props : { displayName: name, ...props };
      this.functionDefs.set(normalizedName, {
        children: children || [],
        ...propsWithDisplayName
      });
    }
    this._invalidateInternalCompiledPool();
    return this;
  }

  async build(rootStructure) {
    const definedFunctions = this._getFunctionDefs();
    this._log('debug', 'Starting tree build', {
      rootName: rootStructure?.name,
      definedFunctionCount: definedFunctions.size
    });

    const compiledPool = await this._ensureCompiledPool();
    const tree = await this._buildNode(rootStructure);
    const finalTree = this.config.showMinimal ? this._applyShowMinimal(tree, rootStructure.name?.toLowerCase()) : tree;

    this._log('debug', 'Completed tree build', {
      resolvedFunctionContexts: compiledPool.resolvedFunctions.size
    });

    return finalTree;
  }

  async _buildNode(node, visited = new Set(), path = []) {
    return await this._buildNodeByMode(node, visited, path, 'full');
  }

  _getBuildNodeModeConfig(mode) {
    if (mode === 'full') {
      return {
        resolveFunction: (name, visited, path) => this._getFunctionWithCycleCheck(name, visited, path),
        wrapperQueueNameProps: {}
      };
    }

    if (mode === 'lazy') {
      return {
        resolveFunction: (name, visited, path) => this._resolveFunctionShallow(name, visited, path),
        wrapperQueueNameProps: { queueName: undefined }
      };
    }

    throw new Error(`Unsupported build mode: ${mode}`);
  }

  async _buildNodeByMode(node, visited = new Set(), path = [], mode = 'full') {
    const { resolveFunction, wrapperQueueNameProps } = this._getBuildNodeModeConfig(mode);

    if (node.ref && !node.async && !node.topicPublish) {
      return await resolveFunction(node.ref, visited, path);
    }

    if (node.ref && node.async) {
      return this._buildAsyncWrapper(node, visited, path, resolveFunction, wrapperQueueNameProps);
    }

    if (node.topicPublish) {
      return this._buildTopicPublishNode(node, wrapperQueueNameProps);
    }

    const { usesLegacyGatewayHttpClient, ctg, ...nodeWithoutFlag } = node;
    const result = { ...nodeWithoutFlag };

    if (!node.children) {
      if (usesLegacyGatewayHttpClient === true) {
        result.children = [{ name: 'SMART Call Over HTTPS', type: 'smart' }];
      }
      return this._applyLogMetadataLine(result, {}, {});
    }

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
      this._buildNodeByMode(child, newVisited, newPath, mode)
    ));
    result.children = resolvedChildren.filter(child => child !== null);

    if (usesLegacyGatewayHttpClient === true) {
      result.children.push({ name: 'SMART Call Over HTTPS', type: 'smart' });
    }

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

  async _getFunctionWithCycleCheck(name, visited, path) {
    const normalizedName = this._normalizeName(name);
    const displayName = this._getDisplayName(name);

    if (visited.has(normalizedName)) {
      return this._createCycleStopper(displayName, path);
    }

    const cacheKey = this._getFunctionCacheKey(normalizedName, visited);
    const cached = this._getActiveCompiledPool()?.resolvedFunctions.get(cacheKey) || this.resolvedFunctions.get(cacheKey);
    if (cached) {
      return cached;
    }

    return await this._resolveAndCacheFunction(name, visited, path);
  }

  _shouldTrack(type) {
    return type === 'function';
  }

  _applyShowMinimal(node, rootAppName, crossedBoundary = false) {
    if (!node) return node;

    const nodeCrossesBoundary = node.type === 'function' &&
      (!node.app || node.app.toLowerCase() !== rootAppName);
    const isCrossed = crossedBoundary || nodeCrossesBoundary;

    let result = node;
    let modified = false;

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

  async buildLazy(rootStructure) {
    this._log('debug', 'Starting lazy tree build', {
      rootName: rootStructure?.name
    });
    const tree = await this._buildNodeLazy(rootStructure, new Set(), []);
    this._log('debug', 'Completed lazy tree build');
    return tree;
  }

  async buildLazyFrom(functionName) {
    this._log('debug', 'Starting lazy build from function', { functionName });
    const result = await this._resolveFunctionShallow(functionName, new Set(), []);
    this._log('debug', 'Completed lazy build from function');
    return result;
  }

  async _buildNodeLazy(node, visited = new Set(), path = []) {
    return await this._buildNodeByMode(node, visited, path, 'lazy');
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
      topicName,
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

export { TreeBuilder, LogDecider, compileFunctionPool, ref, asyncRef, topicPublishRef };
