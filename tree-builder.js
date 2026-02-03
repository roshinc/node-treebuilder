/**
 * Tree Builder Utility
 */

class TreeBuilder {
  constructor() {
    this.functionDefs = new Map();      // registry of function definitions
    this.resolvedFunctions = new Map(); // cache of resolved function subtrees
    this.asyncRefResolver = null; // resolver to get the queue stats
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

  defineFunction(name, children = [], extraProps = {}) {
    this.functionDefs.set(name, { children, ...extraProps });
    return this;
  }

  defineFunctions(defs) {
    for (const [name, def] of Object.entries(defs)) {
      const { children, ...props } = def;
      this.functionDefs.set(name, {
        children: children || [],
        ...props
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
   */
  async _resolveAndCacheFunction(name, visited, path) {
    // Cycle detection
    if (visited.has(name)) {
      // Return a cycle marker (not cached - each occurrence gets current path)
      return {
        name: `loop detected stopping (${name})`,
        type: 'dupe-stopper',
        _cycleAt: name,
        _path: [...path, name]
      };
    }

    // Already resolved? Return cached version
    if (this.resolvedFunctions.has(name)) {
      return this.resolvedFunctions.get(name);
    }

    const def = this.functionDefs.get(name);
    if (!def) {
      // Undefined function becomes leaf
      const leaf = { name, type: 'function' };
      this.resolvedFunctions.set(name, leaf);
      return leaf;
    }

    const { children, app, ...props } = def;
    const newVisited = new Set(visited);
    newVisited.add(name);
    const newPath = [...path, name];

    // Transform 'app' field into a metadata_line entry
    let finalProps = { ...props };
    if (app) {
      const appMetadataLine = { text: app, clickable: false };
      finalProps.metadata_lines = [
        appMetadataLine,
        ...(props.metadata_lines || [])
      ];
    }

    // Create node (add to cache BEFORE resolving children to handle self-reference)
    const resolved = {
      name,
      type: 'function',
      ...finalProps
    };

    // Placeholder in cache to handle direct self-reference
    this.resolvedFunctions.set(name, resolved);

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

      let resolvedProps = {};
      if (this.asyncResolver) {
        console.log("TreeBuilder calling async resolver");
        resolvedProps = await this.asyncResolver(ref, queueName) || {};
      } else {
        console.debug("Async resolver was not set");
      }

      // Merge, resolver props override existing, but existing queueName is fallback
      const finalQueueName = resolvedProps.queueName || queueName || `${ref}_queue`;

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
      let resolvedProps = {};
      if (this.asyncResolver) {
        console.log("resolving async ref with resolver");
        resolvedProps = await this.asyncResolver(ref, queueName) || {};
        console.log("After resolving async ref with resolver");
        console.log(resolvedProps);
      }

      console.log(resolvedProps);

      const finalQueueName = resolvedProps.queueName || queueName || `${ref}_queue`;

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

    result.children = await Promise.all(node.children.map(child =>
      this._buildNode(child, newVisited, newPath)
    ));

    return result;
  }

  /**
   * Get a function from cache, with cycle check for current path.
   */
  _getFunctionWithCycleCheck(name, visited, path) {
    if (visited.has(name)) {
      return {
        name: `loop detected stopping (${name})`,
        type: 'dupe-stopper',
        _cycleAt: name,
        _path: [...path, name]
      };
    }

    const cached = this.resolvedFunctions.get(name);
    if (cached) {
      return cached;
    }

    // Not in cache (undefined function) - return leaf
    return { name, type: 'function' };
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
