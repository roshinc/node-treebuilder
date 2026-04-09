import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, ref, asyncRef, topicPublishRef } from '../tree-builder.js';
import { prepareBuiltTree, get, getFrom } from '../built-tree-lazy.js';

function stripIds(value) {
  if (Array.isArray(value)) {
    return value.map(stripIds);
  }

  if (value && typeof value === 'object') {
    const stripped = {};
    for (const [key, childValue] of Object.entries(value)) {
      if (key === '_nodeId' || key === '_parentNodeId') {
        continue;
      }
      stripped[key] = stripIds(childValue);
    }
    return stripped;
  }

  return value;
}

function collectNodes(node) {
  const nodes = [];

  function visit(current) {
    if (!current) {
      return;
    }

    nodes.push(current);
    if (Array.isArray(current.children)) {
      current.children.forEach(visit);
    }
  }

  visit(node);
  return nodes;
}

function findNodesByName(node, name) {
  return collectNodes(node).filter(current => current.name === name);
}

describe('built-tree-lazy', () => {
  it('prepareBuiltTree should clone the full tree and assign unique parent-linked ids', async () => {
    const builder = new TreeBuilder();
    builder.defineFunctions({
      child: {},
      parent: { children: [ref('child')] }
    });

    const app = {
      name: 'test-app',
      type: 'app',
      children: [ref('parent')]
    };

    const fullTree = await builder.build(app);
    const preparedTree = prepareBuiltTree(fullTree);

    assert.equal(fullTree._nodeId, undefined);
    assert.equal(fullTree.children[0]._nodeId, undefined);
    assert.notEqual(preparedTree, fullTree);
    assert.notEqual(preparedTree.children[0], fullTree.children[0]);

    const preparedNodes = collectNodes(preparedTree);
    const ids = preparedNodes.map(node => node._nodeId);
    assert.equal(new Set(ids).size, ids.length);
    assert.deepEqual(ids, [1, 2, 3]);

    assert.equal(preparedTree._parentNodeId, undefined);
    assert.equal(preparedTree.children[0]._parentNodeId, preparedTree._nodeId);
    assert.equal(preparedTree.children[0].children[0]._parentNodeId, preparedTree.children[0]._nodeId);
  });

  it('get should match buildLazy for lazy function expansion and preserve ids for follow-up expansion', async () => {
    const builder = new TreeBuilder();
    builder.defineFunctions({
      grandchild: {},
      child: { children: [ref('grandchild')] },
      parent: { children: [ref('child')] }
    });

    const app = {
      name: 'test-app',
      type: 'app',
      children: [ref('parent')]
    };

    const fullTree = await builder.build(app);
    const preparedTree = prepareBuiltTree(fullTree);
    const lazyFromBuilt = get(preparedTree);
    const lazyFromBuilder = await builder.buildLazy(app);

    assert.deepEqual(stripIds(lazyFromBuilt), lazyFromBuilder);

    const parentNode = lazyFromBuilt.children[0];
    const childNode = parentNode.children[0];
    assert.equal(parentNode._nodeId, 2);
    assert.equal(childNode._parentNodeId, parentNode._nodeId);
    assert.equal(childNode.loadChildren, true);
  });

  it('get should match buildLazy for async wrappers, ui-services, topic nodes, ctg nodes, SMART nodes, and metadata', async () => {
    const builder = new TreeBuilder();
    builder.defineFunctions({
      leaf: {},
      asyncFunc: { children: [ref('leaf')], queueName: 'ASYNC.Q' },
      ctgFunc: { ctg: true },
      pubFunc: {
        children: [topicPublishRef('myEvent', 'EVENT.Q')]
      },
      legacyFunc: {
        app: 'LegacyApp',
        metadata_lines: [{ text: 'DB: TABLE', clickable: true }],
        children: [ref('leaf')],
        usesLegacyGatewayHttpClient: true
      }
    });

    const app = {
      name: 'test-app',
      type: 'app',
      children: [
        asyncRef('asyncFunc', 'ASYNC.Q'),
        {
          name: 'Services',
          type: 'ui-services',
          children: [
            {
              name: 'publishMethod',
              type: 'ui-service-method',
              children: [ref('pubFunc')]
            }
          ]
        },
        ref('ctgFunc'),
        ref('legacyFunc')
      ]
    };

    const fullTree = await builder.build(app);
    const preparedTree = prepareBuiltTree(fullTree);

    assert.deepEqual(stripIds(get(preparedTree)), await builder.buildLazy(app));
  });

  it('getFrom should expand the exact function occurrence for branches with different loop outcomes', async () => {
    const builder = new TreeBuilder();
    builder.defineFunctions({
      A: { children: [ref('shared')] },
      B: { children: [ref('shared')] },
      shared: { children: [ref('A')] }
    });

    const app = {
      name: 'test-app',
      type: 'app',
      children: [ref('A'), ref('B')]
    };

    const preparedTree = prepareBuiltTree(await builder.build(app));
    const initialLazyTree = get(preparedTree);
    const sharedNodes = findNodesByName(initialLazyTree, 'shared');

    assert.equal(sharedNodes.length, 2);

    const expandedFromA = getFrom(preparedTree, sharedNodes[0]._nodeId);
    const expandedFromB = getFrom(preparedTree, sharedNodes[1]._nodeId);

    assert.equal(expandedFromA._nodeId, sharedNodes[0]._nodeId);
    assert.equal(expandedFromA.children[0].type, 'loop');
    assert.ok(expandedFromA.children[0].name.includes('A'));

    assert.equal(expandedFromB._nodeId, sharedNodes[1]._nodeId);
    assert.equal(expandedFromB.children[0].name, 'A');
    assert.equal(expandedFromB.children[0].loadChildren, true);
    assert.equal(expandedFromB.children[0].children, undefined);
  });

  it('getFrom should expand leaf functions and async wrapper nodes from the ids returned by get', async () => {
    const builder = new TreeBuilder();
    builder.defineFunctions({
      leaf: {},
      asyncChild: { children: [ref('leaf')], queueName: 'ASYNC.Q' },
      parent: { children: [asyncRef('asyncChild', 'ASYNC.Q')] }
    });

    const app = {
      name: 'test-app',
      type: 'app',
      children: [ref('parent'), ref('leaf')]
    };

    const preparedTree = prepareBuiltTree(await builder.build(app));
    const initialLazyTree = get(preparedTree);
    const [parentNode] = findNodesByName(initialLazyTree, 'parent');
    const timerNode = parentNode.children[0];
    const leafNode = initialLazyTree.children[1];

    const expandedTimer = getFrom(preparedTree, timerNode._nodeId);
    const expandedLeaf = getFrom(preparedTree, leafNode._nodeId);

    assert.equal(expandedTimer.type, 'timer');
    assert.equal(expandedTimer._nodeId, timerNode._nodeId);
    assert.equal(expandedTimer.children[0].name, 'asyncChild');
    assert.equal(expandedTimer.children[0]._parentNodeId, expandedTimer._nodeId);
    assert.equal(expandedTimer.children[0].children[0].name, 'leaf');

    assert.deepEqual(stripIds(expandedLeaf), {
      name: 'leaf',
      type: 'function'
    });
  });

  it('getFrom should throw when the node id does not exist', async () => {
    const preparedTree = prepareBuiltTree({
      name: 'test-app',
      type: 'app',
      children: []
    });

    assert.throws(
      () => getFrom(preparedTree, 999),
      /Node with id "999" was not found/
    );
  });
});
