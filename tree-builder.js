/**
 * Tree Builder Utility
 */

class TreeBuilder {
  constructor(config = {}) {
    this.functionDefs = new Map();      // registry of function definitions
    this.resolvedFunctions = new Map(); // cache of resolved function subtrees
    this.asyncRefResolver = null; // resolver to get the queue stats
    // Config with defaults
    this.config = {
      unresolvedSeverity: config.unresolvedSeverity || 'warning', // 'error' or 'warning'
      filterEmptyUiServiceMethods: config.filterEmptyUiServiceMethods || false, // omit ui-service-methods with no children
      filterEmptyUiServices: config.filterEmptyUiServices || false // omit ui-services with no children (after filtering methods)
    };
    console.debug("TreeBuilder constructed")
  }

  setAsyncResolver(resolver) {
    this.asyncResolver = resolver;
    return this;
  }

  setTopicPublishResolver(resolver) {
    this.topicPublishResolver = resolver;
    return this;
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
    // Clear cache for fresh build
    this.resolvedFunctions.clear();
    // First pass: resolve all functions (builds cache)
    await this._preResolveAllFunctions();
    // Second pass: build tree using cached functions
    return await this._buildNode(rootStructure);
  }

  /**
   * Pre-resolve all defined functions to populate cache.
   * This ensures consistent subtrees everywhere.
   */
  async _preResolveAllFunctions() {
    for (const name of this.functionDefs.keys()) {
      if (!this.resolvedFunctions.has(name)) {
        await this._resolveAndCacheFunction(name, new Set(), []);
      }
    }
  }

  /**
   * Resolve a function and cache it.
   * Cycle detection is path-based during this phase.
   * Uses normalized (lowercase) names for lookups and cache keys.
   */
  async _resolveAndCacheFunction(name, visited, path) {
    // Normalize for case-insensitive lookup
    const normalizedName = this._normalizeName(name);

    // Cycle detection (use normalized name)
    if (visited.has(normalizedName)) {
      // Return a cycle marker (not cached - each occurrence gets current path)
      const displayName = this._getDisplayName(name);
      return {
        name: `loop detected stopping (${displayName})`,
        type: 'dupe-stopper',
        _cycleAt: displayName,
        _path: [...path, displayName]
      };
    }

    // Already resolved? Return cached version (use normalized name for cache)
    if (this.resolvedFunctions.has(normalizedName)) {
      return this.resolvedFunctions.get(normalizedName);
    }

    const def = this.functionDefs.get(normalizedName);
    if (!def) {
      // Undefined function becomes error/warning node
      const unresolvedNode = {
        name: `dependency to ${name} could not be resolved so the tree may be incomplete`,
        type: this.config.unresolvedSeverity,
        _unresolvedRef: name
      };
      this.resolvedFunctions.set(normalizedName, unresolvedNode);
      return unresolvedNode;
    }

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

    // Create node (add to cache BEFORE resolving children to handle self-reference)
    // Use displayName for the output name
    const resolved = {
      name: outputName,
      type: 'function',
      ...finalProps
    };

    // Placeholder in cache to handle direct self-reference (use normalized name for cache key)
    this.resolvedFunctions.set(normalizedName, resolved);

    // Resolve children
    if (children && children.length > 0) {
      resolved.children = await Promise.all(
        children.map(child => this._resolveChild(child, newVisited, newPath))
      );
    }

    return resolved;
  }

  /**
   * Resolve a child node during pre-resolution phase.
   */
  async _resolveChild(child, visited, path) {
    // Sync reference
    // console.debug("Resolving Sync Child");
    // console.debug(child);
    if (child.ref && !child.async && !child.topicPublish) {
      return this._resolveAndCacheFunction(child.ref, visited, path);
    }



    // Async reference = queue wrapper
    // call resolver if set
    if (child.ref && child.async) {
      console.debug("Resolving Async Child");
      console.log("resolving asyn in _resolveChild");
      const { ref, async: _, queueName, ...existingProps } = child;

      // Look up the function definition's queueName (default queue for async refs to this function)
      // Use normalized name for case-insensitive lookup
      const normalizedRef = this._normalizeName(ref);
      const funcDef = this.functionDefs.get(normalizedRef);
      const funcQueueName = funcDef?.queueName;
      const displayName = this._getDisplayName(ref);

      let resolvedProps = {};
      if (this.asyncResolver) {
        console.log("TreeBuilder calling async resolver");
        // Pass the effective queueName to resolver: ref's queueName > function's queueName
        const effectiveQueueName = queueName || funcQueueName;
        resolvedProps = await this.asyncResolver(ref, effectiveQueueName) || {};
      } else {
        console.debug("Async resolver was not set");
      }

      // Priority: resolver > ref's queueName > function's queueName > default (use displayName for default)
      const finalQueueName = resolvedProps.queueName || queueName || funcQueueName || `${displayName}_queue`;

      return {
        name: finalQueueName,
        type: 'timer', //'queue',
        ...existingProps,
        ...resolvedProps,
        queueName: undefined, // clean up, name is already set
        children: [await this._resolveAndCacheFunction(ref, visited, path)]
      };
    }

    // Topic Publish refrence = queue wrapper
    if (child.topicPublish) {
      console.log(child);
      const { ref, topicName, topicPublish: _, queueName, ...existingProps } = child;
      let resolvedProps = {};
      if (this.topicPublishResolver) {
        console.log("TreeBuilder calling topic publish resolver");
        try {
          resolvedProps = await this.topicPublishResolver(topicName, queueName) || {};
        } catch (error) {
          console.error(error);
        }
      } else {
        console.debug("topic publish resolver was not set");
      }

      // Merge, resolver props override existing, but existing queueName is fallback
      const finalQueueName = resolvedProps.queueName || queueName || `${topicName}_queue`;

      return {
        name: finalQueueName,
        type: 'topic', //'queue',
        ...existingProps,
        ...resolvedProps,
        queueName: undefined, // clean up, name is already set
        //children: [await this._resolveAndCacheFunction(ref, visited, path)]
      };
    }

    // Inline queue
    if (child.type === 'queue' || child.type === 'timer' || child.type === 'topic') {
      return {
        ...child,
        children: await Promise.all(child.children?.map(c => this._resolveChild(c, visited, path))) || []
      };
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
      return this._getFunctionWithCycleCheck(node.ref, visited, path);
    }

    // Async reference = queue wrapper
    if (node.ref && node.async) {
      console.log("resolving asyn in build node");
      const { ref, async: _, queueName, ...queueProps } = node;

      // Look up the function definition's queueName (default queue for async refs to this function)
      // Use normalized name for case-insensitive lookup
      const normalizedRef = this._normalizeName(ref);
      const funcDef = this.functionDefs.get(normalizedRef);
      const funcQueueName = funcDef?.queueName;
      const displayName = this._getDisplayName(ref);

      let resolvedProps = {};
      if (this.asyncResolver) {
        console.log("resolving async ref with resolver");
        // Pass the effective queueName to resolver: ref's queueName > function's queueName
        const effectiveQueueName = queueName || funcQueueName;
        resolvedProps = await this.asyncResolver(ref, effectiveQueueName) || {};
        console.log("After resolving async ref with resolver");
        console.log(resolvedProps);
      }

      console.log(resolvedProps);

      // Priority: resolver > ref's queueName > function's queueName > default (use displayName for default)
      const finalQueueName = resolvedProps.queueName || queueName || funcQueueName || `${displayName}_queue`;

      return {
        name: finalQueueName,
        type: 'timer',
        ...queueProps,
        ...resolvedProps,
        children: [this._getFunctionWithCycleCheck(ref, visited, path)]
      };
    }

    // Topic Publish refrence = queue wrapper
    if (node.topicPublish) {
      const { ref, topicName, topicPublish: _, queueName, ...queueProps } = node;
      let resolvedProps = {};
      if (this.topicPublishResolver) {
        console.log("resolving topic publish ref with resolver");
        resolvedProps = await this.topicPublishResolver(topicName, queueName) || {};
        console.log("After resolving publish ref with resolver");
        console.log(resolvedProps);
      }

      console.log(resolvedProps);

      const finalQueueName = resolvedProps.queueName || queueName || `${ref}_queue`;

      return {
        name: finalQueueName,
        type: 'timer',
        ...queueProps,
        ...resolvedProps,
        //children: [this._getFunctionWithCycleCheck(ref, visited, path)]
      };
    }

    // Copy node
    const result = { ...node };

    if (!node.children) return result;

    // Track path for ui-service-method and function types
    let newVisited = visited;
    let newPath = path;

    if (this._shouldTrack(node.type) && node.name) {
      if (visited.has(node.name)) {
        return {
          name: `loop detected stopping (${node.name})`,
          type: 'dupe-stopper',
          _cycleAt: node.name,
          _path: [...path, node.name]
        };
      }
      newVisited = new Set(visited);
      newVisited.add(node.name);
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

    return result;
  }

  /**
   * Get a function from cache, with cycle check for current path.
   * Uses normalized (lowercase) names for lookups.
   */
  _getFunctionWithCycleCheck(name, visited, path) {
    // Normalize for case-insensitive lookup
    const normalizedName = this._normalizeName(name);
    const displayName = this._getDisplayName(name);

    if (visited.has(normalizedName)) {
      return {
        name: `loop detected stopping (${displayName})`,
        type: 'dupe-stopper',
        _cycleAt: displayName,
        _path: [...path, displayName]
      };
    }

    const cached = this.resolvedFunctions.get(normalizedName);
    if (cached) {
      return cached;
    }

    // Not in cache (undefined function) - return error/warning node
    return {
      name: `dependency to ${name} could not be resolved so the tree may be incomplete`,
      type: this.config.unresolvedSeverity,
      _unresolvedRef: name
    };
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
