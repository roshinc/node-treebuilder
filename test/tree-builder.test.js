/**
 * Unit tests for TreeBuilder
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, ref, asyncRef, topicPublishRef } from '../tree-builder.js';

describe('TreeBuilder', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
    });

    describe('constructor', () => {
        it('should create a new instance', () => {
            assert.ok(builder instanceof TreeBuilder);
        });

        it('should initialize empty function definitions', () => {
            assert.equal(builder.functionDefs.size, 0);
        });
    });

    describe('defineFunction', () => {
        it('should define a function with no children', () => {
            builder.defineFunction('myFunc');
            assert.equal(builder.functionDefs.size, 1);
            assert.ok(builder.functionDefs.has('myFunc'));
        });

        it('should define a function with children', () => {
            builder.defineFunction('parent', [ref('child1'), ref('child2')]);
            const def = builder.functionDefs.get('parent');
            assert.equal(def.children.length, 2);
        });

        it('should define a function with extra properties', () => {
            builder.defineFunction('myFunc', [], { customProp: 'value' });
            const def = builder.functionDefs.get('myFunc');
            assert.equal(def.customProp, 'value');
        });

        it('should return the builder for chaining', () => {
            const result = builder.defineFunction('func1');
            assert.equal(result, builder);
        });
    });

    describe('defineFunctions', () => {
        it('should define multiple functions from an object', () => {
            builder.defineFunctions({
                func1: {},
                func2: { children: [ref('func1')] },
                func3: {}
            });
            assert.equal(builder.functionDefs.size, 3);
        });

        it('should handle functions with no children property', () => {
            builder.defineFunctions({
                leafFunc: {}
            });
            const def = builder.functionDefs.get('leafFunc');
            assert.deepEqual(def.children, []);
        });

        it('should return the builder for chaining', () => {
            const result = builder.defineFunctions({ func1: {} });
            assert.equal(result, builder);
        });
    });

    describe('build', () => {
        it('should build a simple app with no function refs', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: []
            };
            const tree = await builder.build(app);
            assert.equal(tree.name, 'test-app');
            assert.equal(tree.type, 'app');
            assert.deepEqual(tree.children, []);
        });

        it('should resolve function references', async () => {
            builder.defineFunctions({
                myFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'myFunc' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].name, 'myFunc');
            assert.equal(tree.children[0].type, 'function');
        });

        it('should resolve nested function references', async () => {
            builder.defineFunctions({
                child: {},
                parent: { children: [ref('child')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parent' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'parent');
            assert.equal(tree.children[0].children.length, 1);
            assert.equal(tree.children[0].children[0].name, 'child');
        });

        it('should handle undefined functions as leaf nodes', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'undefinedFunc' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'undefinedFunc');
            assert.equal(tree.children[0].type, 'function');
        });

        it('should detect cycles and create dupe-stopper nodes', async () => {
            builder.defineFunctions({
                funcA: { children: [ref('funcB')] },
                funcB: { children: [ref('funcA')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcA' }]
            };

            const tree = await builder.build(app);
            // funcA -> funcB -> (cycle at funcA)
            const funcB = tree.children[0].children[0];
            assert.equal(funcB.name, 'funcB');
            assert.equal(funcB.children[0].type, 'dupe-stopper');
            assert.ok(funcB.children[0].name.includes('funcA'));
        });

        it('should handle self-referencing functions', async () => {
            builder.defineFunctions({
                selfRef: { children: [ref('selfRef')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'selfRef' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'selfRef');
            assert.equal(tree.children[0].children[0].type, 'dupe-stopper');
        });

        it('should preserve ui-services structure', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            {
                                name: 'method1',
                                type: 'ui-service-method'
                            }
                        ]
                    }
                ]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'ui-services');
            assert.equal(tree.children[0].children[0].type, 'ui-service-method');
        });

        it('should resolve refs inside ui-service-methods', async () => {
            builder.defineFunctions({
                helperFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            {
                                name: 'method1',
                                type: 'ui-service-method',
                                children: [{ ref: 'helperFunc' }]
                            }
                        ]
                    }
                ]
            };

            const tree = await builder.build(app);
            const method = tree.children[0].children[0];
            assert.equal(method.children[0].name, 'helperFunc');
            assert.equal(method.children[0].type, 'function');
        });
    });

    describe('async references', () => {
        it('should wrap async refs in timer nodes', async () => {
            builder.defineFunctions({
                asyncFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true, queueName: 'TEST.QUEUE' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'timer');
            assert.equal(tree.children[0].name, 'TEST.QUEUE');
            assert.equal(tree.children[0].children[0].name, 'asyncFunc');
        });

        it('should generate default queue name if not provided', async () => {
            builder.defineFunctions({
                asyncFunc: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'asyncFunc_queue');
        });

        it('should call async resolver when set', async () => {
            let resolverCalled = false;
            let resolverArgs = null;

            builder.defineFunctions({
                asyncFunc: {}
            });

            builder.setAsyncResolver((funcName, queueName) => {
                resolverCalled = true;
                resolverArgs = { funcName, queueName };
                return { queueName: 'RESOLVED.QUEUE', depth: 5 };
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true, queueName: 'ORIGINAL.QUEUE' }]
            };

            const tree = await builder.build(app);
            assert.ok(resolverCalled);
            assert.equal(resolverArgs.funcName, 'asyncFunc');
            assert.equal(tree.children[0].name, 'RESOLVED.QUEUE');
            assert.equal(tree.children[0].depth, 5);
        });
    });

    describe('topic publish references', () => {
        it('should create topic nodes for topicPublish refs', async () => {
            builder.defineFunctions({
                publisherFunc: {
                    children: [{ topicName: 'myTopic', topicPublish: true }]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'publisherFunc' }]
            };

            const tree = await builder.build(app);
            const topicNode = tree.children[0].children[0];
            assert.equal(topicNode.type, 'topic');
            assert.ok(topicNode.name.includes('myTopic'));
        });

        it('should call topic publish resolver when set', async () => {
            let resolverCalled = false;

            builder.defineFunctions({
                publisherFunc: {
                    children: [{ topicName: 'myTopic', topicPublish: true }]
                }
            });

            builder.setTopicPublishResolver((topicName, queueName) => {
                resolverCalled = true;
                return { queueName: 'TOPIC.RESOLVED.QUEUE' };
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'publisherFunc' }]
            };

            await builder.build(app);
            assert.ok(resolverCalled);
        });
    });

    describe('static helper functions', () => {
        it('ref() should create a sync reference object', () => {
            const result = ref('funcName');
            assert.deepEqual(result, { ref: 'funcName' });
        });

        it('asyncRef() should create an async reference object', () => {
            const result = asyncRef('funcName', 'MY.QUEUE');
            assert.deepEqual(result, {
                ref: 'funcName',
                async: true,
                queueName: 'MY.QUEUE'
            });
        });

        it('asyncRef() should merge extra props', () => {
            const result = asyncRef('funcName', 'MY.QUEUE', { priority: 'high' });
            assert.equal(result.priority, 'high');
        });

        it('topicPublishRef() should create a topic publish reference', () => {
            const result = topicPublishRef('eventName', 'QUEUE.NAME');
            assert.equal(result.topicName, 'eventName');
            assert.equal(result.topicPublish, true);
            assert.equal(result.async, false);
            assert.equal(result.queueName, 'QUEUE.NAME');
        });
    });

    describe('multiple builds', () => {
        it('should clear cache between builds', async () => {
            builder.defineFunctions({
                func1: {}
            });

            const app1 = {
                name: 'app1',
                type: 'app',
                children: [{ ref: 'func1' }]
            };

            const app2 = {
                name: 'app2',
                type: 'app',
                children: [{ ref: 'func1' }]
            };

            const tree1 = await builder.build(app1);
            const tree2 = await builder.build(app2);

            assert.equal(tree1.name, 'app1');
            assert.equal(tree2.name, 'app2');
            // Both should resolve func1 correctly
            assert.equal(tree1.children[0].name, 'func1');
            assert.equal(tree2.children[0].name, 'func1');
        });
    });
});
