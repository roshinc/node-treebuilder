import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, LogDecider, compileFunctionPool, ref, asyncRef } from '../tree-builder.js';

describe('compileFunctionPool', () => {
  it('should build multiple app trees from one compiled pool with the same output as fresh builds', async () => {
    const functionPool = {
      worker: {
        metadata_lines: [{ text: 'worker metadata', clickable: false }]
      },
      mixedFunc: {
        app: 'child-app',
        children: [
          asyncRef('worker'),
          { topicPublish: true, topicName: 'doneEvent' },
          ref('missingFunc')
        ]
      },
      parentFunc: {
        children: [ref('mixedFunc')]
      }
    };

    const compileOptions = {
      asyncResolver: () => ({ queueName: 'ASYNC.Q' }),
      topicPublishResolver: () => ({ queueName: 'TOPIC.Q' }),
      logDecider: new LogDecider(['function', 'timer', 'topic'])
    };

    const compiledPool = await compileFunctionPool(functionPool, compileOptions);

    const compiledBuilder = new TreeBuilder({ compiledPool });
    const freshBuilder = new TreeBuilder();
    freshBuilder.setAsyncResolver(compileOptions.asyncResolver);
    freshBuilder.setTopicPublishResolver(compileOptions.topicPublishResolver);
    freshBuilder.setLogDecider(compileOptions.logDecider);
    freshBuilder.defineFunctions(functionPool);

    const app1 = {
      name: 'app-one',
      type: 'app',
      children: [{ ref: 'parentFunc' }]
    };
    const app2 = {
      name: 'app-two',
      type: 'app',
      children: [{ ref: 'PARENTFUNC' }]
    };

    assert.deepEqual(await compiledBuilder.build(app1), await freshBuilder.build(app1));
    assert.deepEqual(await compiledBuilder.build(app2), await freshBuilder.build(app2));
  });

  it('should support compiled pools with tree-specific filtering and showMinimal settings', async () => {
    const functionPool = {
      innerLeaf: {},
      externalBranch: {
        app: 'other-app',
        children: [ref('innerLeaf')]
      },
      rootFunc: {
        app: 'root-app',
        children: [ref('externalBranch')]
      },
      helper: {}
    };

    const compiledPool = await compileFunctionPool(functionPool);
    const app = {
      name: 'root-app',
      type: 'app',
      children: [
        { ref: 'rootFunc' },
        {
          name: 'ServiceGroup',
          type: 'ui-services',
          children: [
            { name: 'emptyMethod', type: 'ui-service-method' },
            { name: 'helperMethod', type: 'ui-service-method', children: [{ ref: 'helper' }] }
          ]
        }
      ]
    };

    const compiledBuilder = new TreeBuilder({
      compiledPool,
      showMinimal: true,
      filterEmptyUiServiceMethods: true
    });
    const freshBuilder = new TreeBuilder({
      showMinimal: true,
      filterEmptyUiServiceMethods: true
    });
    freshBuilder.defineFunctions(functionPool);

    assert.deepEqual(await compiledBuilder.build(app), await freshBuilder.build(app));
  });

  it('should reuse cached resolver output from a compiled pool', async () => {
    const functionPool = {
      child: {},
      parent: {
        children: [asyncRef('child')]
      }
    };

    const compiledPool = await compileFunctionPool(functionPool, {
      asyncResolver: () => ({ queueName: 'OLD.QUEUE' })
    });

    let buildResolverCalls = 0;
    const builder = new TreeBuilder({ compiledPool });
    builder.setAsyncResolver(() => {
      buildResolverCalls += 1;
      return { queueName: 'NEW.QUEUE' };
    });

    const tree = await builder.build({
      name: 'test-app',
      type: 'app',
      children: [{ ref: 'parent' }]
    });

    assert.equal(tree.children[0].children[0].name, 'OLD.QUEUE');
    assert.equal(buildResolverCalls, 0);
  });

  it('should throw when defining a function while constructed with an external compiled pool', async () => {
    const compiledPool = await compileFunctionPool({
      existing: {}
    });

    const builder = new TreeBuilder({ compiledPool });

    assert.throws(
      () => builder.defineFunction('newFunc'),
      /Cannot call defineFunction\(\) while an external compiled pool is attached/
    );
  });

  it('should throw when defining functions after attaching an external compiled pool', async () => {
    const compiledPool = await compileFunctionPool({
      existing: {}
    });

    const builder = new TreeBuilder();
    builder.setCompiledPool(compiledPool);

    assert.throws(
      () => builder.defineFunctions({ newFunc: {} }),
      /Cannot call defineFunctions\(\) while an external compiled pool is attached/
    );
  });

  it('should allow defining functions again after clearing the external compiled pool', async () => {
    const compiledPool = await compileFunctionPool({
      existing: {}
    });

    const builder = new TreeBuilder({ compiledPool });
    builder.setCompiledPool(null);
    builder.defineFunctions({
      localChild: {},
      localParent: {
        children: [ref('localChild')]
      }
    });

    const tree = await builder.build({
      name: 'test-app',
      type: 'app',
      children: [{ ref: 'localParent' }]
    });

    assert.equal(tree.children[0].name, 'localParent');
    assert.equal(tree.children[0].children[0].name, 'localChild');
  });

  it('should produce updated output after recompiling with new resolver behavior', async () => {
    const functionPool = {
      child: {},
      parent: {
        children: [asyncRef('child')]
      }
    };

    const oldCompiledPool = await compileFunctionPool(functionPool, {
      asyncResolver: () => ({ queueName: 'OLD.QUEUE' })
    });
    const newCompiledPool = await compileFunctionPool(functionPool, {
      asyncResolver: () => ({ queueName: 'NEW.QUEUE' })
    });

    const oldTree = await new TreeBuilder({ compiledPool: oldCompiledPool }).build({
      name: 'test-app',
      type: 'app',
      children: [{ ref: 'parent' }]
    });
    const newTree = await new TreeBuilder({ compiledPool: newCompiledPool }).build({
      name: 'test-app',
      type: 'app',
      children: [{ ref: 'parent' }]
    });

    assert.equal(oldTree.children[0].children[0].name, 'OLD.QUEUE');
    assert.equal(newTree.children[0].children[0].name, 'NEW.QUEUE');
  });
});
