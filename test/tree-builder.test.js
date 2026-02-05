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

        it('should handle undefined functions as warning nodes by default', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'undefinedFunc' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'warning');
            assert.equal(tree.children[0].name, 'dependency to undefinedFunc could not be resolved so the tree may be incomplete');
            assert.equal(tree.children[0]._unresolvedRef, 'undefinedFunc');
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

    describe('metadata_lines support', () => {
        it('should preserve metadata_lines on function nodes', async () => {
            builder.defineFunctions({
                funcWithMetadata: {
                    metadata_lines: [
                        { text: 'log', clickable: true, data: { test: 'data' } },
                        { text: 'other' }
                    ]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithMetadata' }]
            };

            const tree = await builder.build(app);
            const func = tree.children[0];

            assert.equal(func.name, 'funcWithMetadata');
            assert.ok(func.metadata_lines, 'Should have metadata_lines');
            assert.equal(func.metadata_lines.length, 2);
            assert.equal(func.metadata_lines[0].text, 'log');
            assert.equal(func.metadata_lines[0].clickable, true);
            assert.deepEqual(func.metadata_lines[0].data, { test: 'data' });
            assert.equal(func.metadata_lines[1].text, 'other');
        });

        it('should preserve metadata_lines on app nodes', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                metadata_lines: [
                    { text: 'App info', clickable: false }
                ],
                children: []
            };

            const tree = await builder.build(app);

            assert.ok(tree.metadata_lines);
            assert.equal(tree.metadata_lines[0].text, 'App info');
        });

        it('should preserve metadata_lines on ui-service-method nodes', async () => {
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
                                metadata_lines: [
                                    { text: 'Method docs', clickable: true, data: { url: '/docs' } }
                                ]
                            }
                        ]
                    }
                ]
            };

            const tree = await builder.build(app);
            const method = tree.children[0].children[0];

            assert.ok(method.metadata_lines);
            assert.equal(method.metadata_lines[0].text, 'Method docs');
            assert.equal(method.metadata_lines[0].clickable, true);
        });

        it('should preserve metadata_lines with nested function refs', async () => {
            builder.defineFunctions({
                child: {
                    metadata_lines: [{ text: 'child info' }]
                },
                parent: {
                    metadata_lines: [{ text: 'parent info' }],
                    children: [ref('child')]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parent' }]
            };

            const tree = await builder.build(app);
            const parent = tree.children[0];
            const child = parent.children[0];

            assert.equal(parent.metadata_lines[0].text, 'parent info');
            assert.equal(child.metadata_lines[0].text, 'child info');
        });
    });

    describe('app field support', () => {
        it('should transform app field into metadata_line with clickable false', async () => {
            builder.defineFunctions({
                funcWithApp: {
                    app: 'MyApp',
                    children: []
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithApp' }]
            };

            const tree = await builder.build(app);
            const func = tree.children[0];

            assert.ok(func.metadata_lines, 'Should have metadata_lines');
            assert.equal(func.metadata_lines.length, 1);
            assert.equal(func.metadata_lines[0].text, 'MyApp');
            assert.equal(func.metadata_lines[0].clickable, false);
            assert.equal(func.metadata_lines[0].data, undefined);
        });

        it('should not include app field in output node', async () => {
            builder.defineFunctions({
                funcWithApp: {
                    app: 'MyApp'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithApp' }]
            };

            const tree = await builder.build(app);
            const func = tree.children[0];

            assert.equal(func.app, undefined, 'app field should not be in output');
        });

        it('should prepend app metadata_line before existing metadata_lines', async () => {
            builder.defineFunctions({
                funcWithAppAndMetadata: {
                    app: 'MyApp',
                    metadata_lines: [
                        { text: 'existing info', clickable: true, data: { key: 'value' } }
                    ],
                    children: []
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithAppAndMetadata' }]
            };

            const tree = await builder.build(app);
            const func = tree.children[0];

            assert.equal(func.metadata_lines.length, 2);
            // App metadata_line should be first
            assert.equal(func.metadata_lines[0].text, 'MyApp');
            assert.equal(func.metadata_lines[0].clickable, false);
            assert.equal(func.metadata_lines[0].data, undefined);
            // Existing metadata_line should be preserved
            assert.equal(func.metadata_lines[1].text, 'existing info');
            assert.equal(func.metadata_lines[1].clickable, true);
            assert.deepEqual(func.metadata_lines[1].data, { key: 'value' });
        });

        it('should handle app field with children references', async () => {
            builder.defineFunctions({
                childFunc1: {},
                asyncFunc: {},
                parentWithApp: {
                    app: 'MyApp',
                    children: [
                        { ref: 'childFunc1' },
                        { ref: 'asyncFunc', async: true, queueName: 'QUEUE.NAME' }
                    ]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parentWithApp' }]
            };

            const tree = await builder.build(app);
            const func = tree.children[0];

            assert.equal(func.name, 'parentWithApp');
            assert.ok(func.metadata_lines);
            assert.equal(func.metadata_lines[0].text, 'MyApp');
            assert.equal(func.metadata_lines[0].clickable, false);
            // Verify children are resolved
            assert.equal(func.children.length, 2);
            assert.equal(func.children[0].name, 'childFunc1');
            assert.equal(func.children[1].type, 'timer');
            assert.equal(func.children[1].name, 'QUEUE.NAME');
        });

        it('should handle function without app field normally', async () => {
            builder.defineFunctions({
                funcWithoutApp: {
                    metadata_lines: [{ text: 'some info' }]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithoutApp' }]
            };

            const tree = await builder.build(app);
            const func = tree.children[0];

            assert.equal(func.metadata_lines.length, 1);
            assert.equal(func.metadata_lines[0].text, 'some info');
        });
    });

    describe('queueName in function pool', () => {
        it('should use function pool queueName for async refs without inline queueName', async () => {
            builder.defineFunctions({
                asyncFunc: {
                    queueName: 'FUNC.DEFAULT.QUEUE'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'timer');
            assert.equal(tree.children[0].name, 'FUNC.DEFAULT.QUEUE');
        });

        it('should prefer inline queueName over function pool queueName', async () => {
            builder.defineFunctions({
                asyncFunc: {
                    queueName: 'FUNC.DEFAULT.QUEUE'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true, queueName: 'INLINE.QUEUE' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'INLINE.QUEUE');
        });

        it('should pass function pool queueName to async resolver when no inline queueName', async () => {
            let receivedQueueName = null;

            builder.defineFunctions({
                asyncFunc: {
                    queueName: 'FUNC.DEFAULT.QUEUE'
                }
            });

            builder.setAsyncResolver((funcName, queueName) => {
                receivedQueueName = queueName;
                return {};
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true }]
            };

            await builder.build(app);
            assert.equal(receivedQueueName, 'FUNC.DEFAULT.QUEUE');
        });

        it('should pass inline queueName to resolver even when function has queueName', async () => {
            let receivedQueueName = null;

            builder.defineFunctions({
                asyncFunc: {
                    queueName: 'FUNC.DEFAULT.QUEUE'
                }
            });

            builder.setAsyncResolver((funcName, queueName) => {
                receivedQueueName = queueName;
                return {};
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true, queueName: 'INLINE.QUEUE' }]
            };

            await builder.build(app);
            assert.equal(receivedQueueName, 'INLINE.QUEUE');
        });

        it('should allow resolver to override function pool queueName', async () => {
            builder.defineFunctions({
                asyncFunc: {
                    queueName: 'FUNC.DEFAULT.QUEUE'
                }
            });

            builder.setAsyncResolver((funcName, queueName) => {
                return { queueName: 'RESOLVER.QUEUE' };
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'RESOLVER.QUEUE');
        });

        it('should not include queueName in resolved function node', async () => {
            builder.defineFunctions({
                funcWithQueue: {
                    queueName: 'FUNC.QUEUE',
                    metadata_lines: [{ text: 'info' }]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithQueue' }]
            };

            const tree = await builder.build(app);
            const func = tree.children[0];

            assert.equal(func.queueName, undefined, 'queueName should not be in output node');
            assert.equal(func.name, 'funcWithQueue');
            assert.ok(func.metadata_lines);
        });

        it('should use function pool queueName for async refs in function children', async () => {
            builder.defineFunctions({
                childFunc: {
                    queueName: 'CHILD.QUEUE'
                },
                parentFunc: {
                    children: [{ ref: 'childFunc', async: true }]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parentFunc' }]
            };

            const tree = await builder.build(app);
            const asyncWrapper = tree.children[0].children[0];
            assert.equal(asyncWrapper.type, 'timer');
            assert.equal(asyncWrapper.name, 'CHILD.QUEUE');
        });

        it('should work with app field and queueName together', async () => {
            builder.defineFunctions({
                funcWithBoth: {
                    app: 'MyApp',
                    queueName: 'MY.QUEUE',
                    metadata_lines: [{ text: 'info' }]
                }
            });

            // Sync ref - should have app metadata, no queueName
            const app1 = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithBoth' }]
            };

            const tree1 = await builder.build(app1);
            const func = tree1.children[0];
            assert.equal(func.metadata_lines[0].text, 'MyApp');
            assert.equal(func.queueName, undefined);

            // Async ref - should use the function's queueName
            const app2 = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'funcWithBoth', async: true }]
            };

            const tree2 = await builder.build(app2);
            assert.equal(tree2.children[0].name, 'MY.QUEUE');
        });
    });

    describe('unresolved reference severity', () => {
        it('should use warning type by default for undefined functions', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingFunc' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'warning');
            assert.ok(tree.children[0].name.includes('missingFunc'));
            assert.ok(tree.children[0].name.includes('could not be resolved'));
        });

        it('should use error type when configured', async () => {
            const errorBuilder = new TreeBuilder({ unresolvedSeverity: 'error' });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingFunc' }]
            };

            const tree = await errorBuilder.build(app);
            assert.equal(tree.children[0].type, 'error');
            assert.equal(tree.children[0].name, 'dependency to missingFunc could not be resolved so the tree may be incomplete');
            assert.equal(tree.children[0]._unresolvedRef, 'missingFunc');
        });

        it('should use warning type when explicitly configured', async () => {
            const warningBuilder = new TreeBuilder({ unresolvedSeverity: 'warning' });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingFunc' }]
            };

            const tree = await warningBuilder.build(app);
            assert.equal(tree.children[0].type, 'warning');
        });

        it('should handle unresolved async refs with configured severity', async () => {
            const errorBuilder = new TreeBuilder({ unresolvedSeverity: 'error' });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'missingAsyncFunc', async: true }]
            };

            const tree = await errorBuilder.build(app);
            // Async ref wraps in timer, child should be error
            assert.equal(tree.children[0].type, 'timer');
            assert.equal(tree.children[0].children[0].type, 'error');
            assert.equal(tree.children[0].children[0]._unresolvedRef, 'missingAsyncFunc');
        });

        it('should handle unresolved nested refs with configured severity', async () => {
            const errorBuilder = new TreeBuilder({ unresolvedSeverity: 'error' });
            errorBuilder.defineFunctions({
                parentFunc: {
                    children: [ref('missingChild')]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parentFunc' }]
            };

            const tree = await errorBuilder.build(app);
            assert.equal(tree.children[0].name, 'parentFunc');
            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].children[0].type, 'error');
            assert.equal(tree.children[0].children[0]._unresolvedRef, 'missingChild');
        });

        it('should include _unresolvedRef property for easy identification', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'unknownFunction' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0]._unresolvedRef, 'unknownFunction');
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
