/**
 * Unit tests for TreeBuilder
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, ref, asyncRef } from '../tree-builder.js';

describe('TreeBuilder', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
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


});
