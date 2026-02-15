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
            // Keys are stored lowercase for case-insensitive lookup
            assert.ok(builder.functionDefs.has('myfunc'));
        });

        it('should define a function with children', () => {
            builder.defineFunction('parent', [ref('child1'), ref('child2')]);
            // Keys are stored lowercase for case-insensitive lookup
            const def = builder.functionDefs.get('parent');
            assert.equal(def.children.length, 2);
        });

        it('should define a function with extra properties', () => {
            builder.defineFunction('myFunc', [], { customProp: 'value' });
            // Keys are stored lowercase for case-insensitive lookup
            const def = builder.functionDefs.get('myfunc');
            assert.equal(def.customProp, 'value');
        });

        it('should return the builder for chaining', () => {
            const result = builder.defineFunction('func1');
            assert.equal(result, builder);
        });

        it('should store displayName preserving original case', () => {
            builder.defineFunction('MyFunc');
            const def = builder.functionDefs.get('myfunc');
            assert.equal(def.displayName, 'MyFunc');
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
            // Keys are stored lowercase for case-insensitive lookup
            const def = builder.functionDefs.get('leaffunc');
            assert.deepEqual(def.children, []);
        });

        it('should return the builder for chaining', () => {
            const result = builder.defineFunctions({ func1: {} });
            assert.equal(result, builder);
        });

        it('should store displayName preserving original case', () => {
            builder.defineFunctions({
                MyFunction: {},
                AnotherFunc: { displayName: 'CustomName' }
            });
            // displayName should preserve original case
            assert.equal(builder.functionDefs.get('myfunction').displayName, 'MyFunction');
            // Explicit displayName should be preserved
            assert.equal(builder.functionDefs.get('anotherfunc').displayName, 'CustomName');
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

        it('should create topic nodes for app-level topicPublish refs', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ topicName: 'myTopic', topicPublish: true }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'topic');
            assert.ok(tree.children[0].name.includes('myTopic'));
        });

        it('should use "unknown topic" for app-level topicPublish refs without topicName', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ topicPublish: true }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'topic');
            assert.equal(tree.children[0].name, 'unknown topic');
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

    describe('filter empty ui-service-methods', () => {
        it('should not filter empty methods when filterEmptyUiServiceMethods is false (default)', async () => {
            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            { name: 'anotherEmpty', type: 'ui-service-method', children: [] }
                        ]
                    }
                ]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].children.length, 2);
        });

        it('should filter out empty ui-service-methods when configured', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServiceMethods: true });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            { name: 'anotherEmpty', type: 'ui-service-method', children: [] }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            assert.equal(tree.children[0].children.length, 0);
        });

        it('should keep ui-service-methods with children when filtering', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServiceMethods: true });
            filterBuilder.defineFunctions({
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
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            {
                                name: 'methodWithChild',
                                type: 'ui-service-method',
                                children: [{ ref: 'helperFunc' }]
                            }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            assert.equal(tree.children[0].children.length, 1);
            assert.equal(tree.children[0].children[0].name, 'methodWithChild');
        });
    });

    describe('filter empty ui-services', () => {
        it('should not filter empty ui-services when filterEmptyUiServices is false (default)', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServiceMethods: true });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // ui-services node should still exist even with no children
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].type, 'ui-services');
            assert.equal(tree.children[0].children.length, 0);
        });

        it('should filter out ui-services with no children when configured', async () => {
            const filterBuilder = new TreeBuilder({
                filterEmptyUiServiceMethods: true,
                filterEmptyUiServices: true
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'ServiceGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // ui-services node should be filtered out
            assert.equal(tree.children.length, 0);
        });

        it('should keep ui-services with non-empty methods when filtering', async () => {
            const filterBuilder = new TreeBuilder({
                filterEmptyUiServiceMethods: true,
                filterEmptyUiServices: true
            });
            filterBuilder.defineFunctions({
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
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            {
                                name: 'methodWithChild',
                                type: 'ui-service-method',
                                children: [{ ref: 'helperFunc' }]
                            }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].type, 'ui-services');
            assert.equal(tree.children[0].children.length, 1);
        });

        it('should filter ui-services without filtering methods when only filterEmptyUiServices is true', async () => {
            const filterBuilder = new TreeBuilder({ filterEmptyUiServices: true });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'EmptyServices',
                        type: 'ui-services',
                        children: []
                    },
                    {
                        name: 'ServicesWithEmptyMethods',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // First ui-services has no children, filtered out
            // Second ui-services has children (empty method not filtered), kept
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].name, 'ServicesWithEmptyMethods');
            assert.equal(tree.children[0].children.length, 1);
        });

        it('should handle multiple ui-services groups with mixed content', async () => {
            const filterBuilder = new TreeBuilder({
                filterEmptyUiServiceMethods: true,
                filterEmptyUiServices: true
            });
            filterBuilder.defineFunctions({
                funcA: {},
                funcB: {}
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [
                    {
                        name: 'EmptyGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' }
                        ]
                    },
                    {
                        name: 'NonEmptyGroup',
                        type: 'ui-services',
                        children: [
                            { name: 'emptyMethod', type: 'ui-service-method' },
                            {
                                name: 'methodA',
                                type: 'ui-service-method',
                                children: [{ ref: 'funcA' }]
                            }
                        ]
                    },
                    {
                        name: 'AnotherEmptyGroup',
                        type: 'ui-services',
                        children: []
                    }
                ]
            };

            const tree = await filterBuilder.build(app);
            // Only NonEmptyGroup should remain
            assert.equal(tree.children.length, 1);
            assert.equal(tree.children[0].name, 'NonEmptyGroup');
            assert.equal(tree.children[0].children.length, 1);
            assert.equal(tree.children[0].children[0].name, 'methodA');
        });
    });

    describe('case-insensitive lookup', () => {
        it('should resolve refs case-insensitively', async () => {
            builder.defineFunctions({
                myfunction: { displayName: 'MyFunction' }
            });

            // Ref with different casing should still resolve
            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'MyFunction' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'function');
            assert.equal(tree.children[0].name, 'MyFunction');
        });

        it('should use displayName in output when pool key is lowercase', async () => {
            builder.defineFunctions({
                publishtrxnholdsreleaseevent: {
                    displayName: 'publishTrxnHoldsReleaseEvent',
                    app: 'dev-nims-ias-publish-events'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'PublishTrxnHoldsReleaseEvent' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'publishTrxnHoldsReleaseEvent');
            assert.equal(tree.children[0].metadata_lines[0].text, 'dev-nims-ias-publish-events');
        });

        it('should handle async refs case-insensitively', async () => {
            builder.defineFunctions({
                asyncfunc: {
                    displayName: 'AsyncFunc',
                    queueName: 'ASYNC_QUEUE'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'ASYNCFUNC', async: true }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'timer');
            assert.equal(tree.children[0].name, 'ASYNC_QUEUE');
            assert.equal(tree.children[0].children[0].name, 'AsyncFunc');
        });

        it('should use displayName for default queue name in async refs', async () => {
            builder.defineFunctions({
                myfunc: {
                    displayName: 'MyFunc'
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'MYFUNC', async: true }]
            };

            const tree = await builder.build(app);
            // Default queue name should use displayName, not the ref casing
            assert.equal(tree.children[0].name, 'MyFunc_queue');
        });

        it('should resolve nested refs case-insensitively', async () => {
            builder.defineFunctions({
                childfunc: { displayName: 'ChildFunc' },
                parentfunc: {
                    displayName: 'ParentFunc',
                    children: [ref('CHILDFUNC')]
                }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'parentFunc' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'ParentFunc');
            assert.equal(tree.children[0].children[0].name, 'ChildFunc');
        });
    });

    describe('logNodeTypes config', () => {
        it('should not add Logs metadata_line when logNodeTypes is not configured', async () => {
            builder.defineFunctions({ myFunc: {} });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines, undefined);
        });

        it('should not add Logs when logNodeTypes is empty array', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: [] });
            logBuilder.defineFunctions({ myFunc: {} });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await logBuilder.build(app);
            assert.equal(tree.children[0].metadata_lines, undefined);
        });

        it('should prepend Logs metadata_line to function nodes when configured', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['function'] });
            logBuilder.defineFunctions({ myFunc: {} });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await logBuilder.build(app);
            const func = tree.children[0];
            assert.ok(func.metadata_lines, 'Should have metadata_lines');
            assert.equal(func.metadata_lines.length, 1);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[0].clickable, true);
            assert.deepEqual(func.metadata_lines[0].data, { name: 'myFunc', type: 'function' });
        });

        it('should prepend Logs before existing metadata_lines', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['function'] });
            logBuilder.defineFunctions({
                myFunc: { metadata_lines: [{ text: 'existing' }] }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await logBuilder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines.length, 2);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[1].text, 'existing');
        });

        it('should prepend Logs before app metadata_line on function nodes', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['function'] });
            logBuilder.defineFunctions({
                myFunc: { app: 'MyApp' }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await logBuilder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines.length, 2);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[0].clickable, true);
            assert.deepEqual(func.metadata_lines[0].data, { name: 'myFunc', type: 'function', app: 'MyApp' });
            assert.equal(func.metadata_lines[1].text, 'MyApp');
            assert.equal(func.metadata_lines[1].clickable, false);
        });

        it('should add Logs metadata_line to timer nodes at app level when configured', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['timer'] });
            logBuilder.defineFunctions({ asyncFunc: {} });
            const app = {
                name: 'test-app', type: 'app',
                children: [{ ref: 'asyncFunc', async: true, queueName: 'Q.NAME' }]
            };
            const tree = await logBuilder.build(app);
            assert.equal(tree.children[0].type, 'timer');
            assert.ok(tree.children[0].metadata_lines);
            assert.equal(tree.children[0].metadata_lines[0].text, 'Logs');
            assert.equal(tree.children[0].metadata_lines[0].clickable, true);
            assert.deepEqual(tree.children[0].metadata_lines[0].data, { name: 'Q.NAME', type: 'timer' });
        });

        it('should add Logs metadata_line to app nodes when configured', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['app'] });
            const app = { name: 'test-app', type: 'app', children: [] };
            const tree = await logBuilder.build(app);
            assert.ok(tree.metadata_lines);
            assert.equal(tree.metadata_lines[0].text, 'Logs');
            assert.equal(tree.metadata_lines[0].clickable, true);
            assert.deepEqual(tree.metadata_lines[0].data, { name: 'test-app', type: 'app' });
        });

        it('should add Logs metadata_line to ui-service-method nodes when configured', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['ui-service-method'] });
            const app = {
                name: 'test-app', type: 'app',
                children: [{
                    name: 'ServiceGroup', type: 'ui-services',
                    children: [{ name: 'method1', type: 'ui-service-method', children: [] }]
                }]
            };
            const tree = await logBuilder.build(app);
            const method = tree.children[0].children[0];
            assert.ok(method.metadata_lines);
            assert.equal(method.metadata_lines[0].text, 'Logs');
            assert.equal(method.metadata_lines[0].clickable, true);
            assert.deepEqual(method.metadata_lines[0].data, { name: 'method1', type: 'ui-service-method' });
        });

        it('should add Logs to multiple node types when configured', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['function', 'timer'] });
            logBuilder.defineFunctions({ myFunc: {} });
            const app = {
                name: 'test-app', type: 'app',
                children: [
                    { ref: 'myFunc' },
                    { ref: 'myFunc', async: true, queueName: 'Q.TEST' }
                ]
            };
            const tree = await logBuilder.build(app);
            // function node should have Logs
            assert.equal(tree.children[0].metadata_lines[0].text, 'Logs');
            assert.deepEqual(tree.children[0].metadata_lines[0].data, { name: 'myFunc', type: 'function' });
            // timer node should have Logs
            assert.equal(tree.children[1].metadata_lines[0].text, 'Logs');
            assert.deepEqual(tree.children[1].metadata_lines[0].data, { name: 'Q.TEST', type: 'timer' });
            // app node should NOT have Logs (not in list)
            assert.equal(tree.metadata_lines, undefined);
        });

        it('should not add Logs to dupe-stopper nodes', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['dupe-stopper', 'function'] });
            logBuilder.defineFunctions({
                funcA: { children: [{ ref: 'funcB' }] },
                funcB: { children: [{ ref: 'funcA' }] }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'funcA' }] };
            const tree = await logBuilder.build(app);
            // funcA -> funcB -> dupe-stopper(funcA)
            const dupeStopper = tree.children[0].children[0].children[0];
            assert.equal(dupeStopper.type, 'dupe-stopper');
            assert.equal(dupeStopper.metadata_lines, undefined);
        });

        it('should add Logs to timer nodes inside function subtrees (pre-resolution)', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['timer'] });
            logBuilder.defineFunctions({
                innerAsync: {},
                parentFunc: {
                    children: [{ ref: 'innerAsync', async: true, queueName: 'INNER.Q' }]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'parentFunc' }] };
            const tree = await logBuilder.build(app);
            // parentFunc -> timer(INNER.Q) -> innerAsync
            const timerNode = tree.children[0].children[0];
            assert.equal(timerNode.type, 'timer');
            assert.equal(timerNode.name, 'INNER.Q');
            assert.ok(timerNode.metadata_lines, 'Timer inside function subtree should have Logs');
            assert.equal(timerNode.metadata_lines[0].text, 'Logs');
            assert.deepEqual(timerNode.metadata_lines[0].data, { name: 'INNER.Q', type: 'timer' });
        });

        it('should add Logs to topic nodes inside function subtrees (pre-resolution)', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['topic'] });
            logBuilder.defineFunctions({
                parentFunc: {
                    children: [{ topicPublish: true, topicName: 'myEvent', queueName: 'EVENT.Q' }]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'parentFunc' }] };
            const tree = await logBuilder.build(app);
            const topicNode = tree.children[0].children[0];
            assert.equal(topicNode.type, 'topic');
            assert.ok(topicNode.metadata_lines, 'Topic inside function subtree should have Logs');
            assert.equal(topicNode.metadata_lines[0].text, 'Logs');
            assert.deepEqual(topicNode.metadata_lines[0].data, { name: 'EVENT.Q', type: 'topic' });
        });

        it('should include app in data when present on function node', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['function'] });
            logBuilder.defineFunctions({
                myFunc: { app: 'TestApp' }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await logBuilder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines[0].data.app, 'TestApp');
        });

        it('should not include app in data when not present on function node', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['function'] });
            logBuilder.defineFunctions({
                myFunc: {}
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await logBuilder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines[0].data.app, undefined);
        });

        it('should handle Logs with app and existing metadata_lines combined', async () => {
            const logBuilder = new TreeBuilder({ logNodeTypes: ['function'] });
            logBuilder.defineFunctions({
                myFunc: {
                    app: 'MyApp',
                    metadata_lines: [{ text: 'DB: TABLE', clickable: true, data: { table: 'T' } }]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await logBuilder.build(app);
            const func = tree.children[0];
            // Order: Logs, app metadata_line, existing metadata_line
            assert.equal(func.metadata_lines.length, 3);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[0].data.app, 'MyApp');
            assert.equal(func.metadata_lines[1].text, 'MyApp');
            assert.equal(func.metadata_lines[1].clickable, false);
            assert.equal(func.metadata_lines[2].text, 'DB: TABLE');
        });
    });
});
