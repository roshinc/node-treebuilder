/**
 * Function pool compiler for TreeBuilder.
 * Produces a reusable cache of fully resolved function subtrees.
 */

import { FunctionResolutionEngine } from './function-resolution-engine.js';

class FunctionPoolCompiler extends FunctionResolutionEngine {
  constructor(defs, options = {}) {
    super({
      defs,
      ...options
    });
  }

  async compile() {
    await this._preResolveAllFunctions();
    return {
      functionDefs: new Map(this.functionDefs),
      resolvedFunctions: new Map(this.resolvedFunctions)
    };
  }
}

async function compileFunctionPool(defs, options = {}) {
  const compiler = new FunctionPoolCompiler(defs, options);
  return await compiler.compile();
}

export { compileFunctionPool };
