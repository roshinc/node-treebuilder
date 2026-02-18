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

        it('should not reuse cycle stoppers from a different root path', async () => {
            builder.defineFunctions({
                A: { children: [ref('B')] },
                B: { children: [ref('C')] },
                C: { children: [ref('B')] },
                D: { children: [ref('C')] }
            });

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'D' }]
            };

            const tree = await builder.build(app);
            const cNode = tree.children[0].children[0];
            assert.equal(cNode.name, 'C');
            assert.equal(cNode.children[0].name, 'B');
            assert.equal(cNode.children[0].children[0].type, 'dupe-stopper');
            assert.ok(cNode.children[0].children[0].name.includes('C'));
        });

        it('should resolve sync+async refs to same function consistently when async children are involved', async () => {
            const raceBuilder = new TreeBuilder({ logNodeTypes: ['function', 'timer'] });
            raceBuilder.defineFunctions({
                A: { children: [ref('B'), asyncRef('B')] },
                B: { children: [asyncRef('C')] },
                C: {}
            });

            raceBuilder.setAsyncResolver(async (funcName) => {
                if (funcName === 'C') {
                    await new Promise(resolve => setTimeout(resolve, 25));
                }
                return {};
            });

            const tree = await raceBuilder.build({
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'A' }]
            });

            const syncB = tree.children[0].children[0];
            const asyncWrapper = tree.children[0].children[1];
            const asyncB = asyncWrapper.children[0];
            assert.equal(syncB.type, 'function');
            assert.equal(asyncWrapper.type, 'timer');
            assert.equal(asyncB.type, 'function');
            assert.deepEqual(syncB.metadata_lines, asyncB.metadata_lines);
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

        it('should keep existing queue values when async resolver returns nothing', async () => {
            builder.defineFunctions({
                asyncFunc: {}
            });

            builder.setAsyncResolver(() => undefined);

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ ref: 'asyncFunc', async: true, queueName: 'ORIGINAL.QUEUE', priority: 'high' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'ORIGINAL.QUEUE');
            assert.equal(tree.children[0].priority, 'high');
        });

        it('should log and annotate async nodes when async resolver throws', async () => {
            builder.defineFunctions({
                asyncFunc: {}
            });

            const consoleErrorOriginal = console.error;
            const consoleErrors = [];
            console.error = (...args) => {
                consoleErrors.push(args);
            };

            try {
                builder.setAsyncResolver(() => {
                    throw new Error('async resolver boom');
                });

                const app = {
                    name: 'test-app',
                    type: 'app',
                    children: [{ ref: 'asyncFunc', async: true, queueName: 'ORIGINAL.QUEUE' }]
                };

                const tree = await builder.build(app);
                assert.equal(tree.children[0].name, 'ORIGINAL.QUEUE');
                assert.equal(tree.children[0].children[0].name, 'asyncFunc');
                assert.ok(tree.children[0].metadata_lines.some(line => line.text.includes('asyncResolver errored out')));
                assert.ok(consoleErrors.length > 0);
            } finally {
                console.error = consoleErrorOriginal;
            }
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

        it('should keep existing queue values when topic publish resolver returns nothing', async () => {
            builder.setTopicPublishResolver(() => null);

            const app = {
                name: 'test-app',
                type: 'app',
                children: [{ topicName: 'myTopic', topicPublish: true, queueName: 'TOPIC.ORIGINAL.QUEUE', stage: 'publish' }]
            };

            const tree = await builder.build(app);
            assert.equal(tree.children[0].name, 'TOPIC.ORIGINAL.QUEUE');
            assert.equal(tree.children[0].stage, 'publish');
        });

        it('should log and annotate topic nodes when topic publish resolver throws', async () => {
            const consoleErrorOriginal = console.error;
            const consoleErrors = [];
            console.error = (...args) => {
                consoleErrors.push(args);
            };

            try {
                builder.setTopicPublishResolver(() => {
                    throw new Error('topic resolver boom');
                });

                const app = {
                    name: 'test-app',
                    type: 'app',
                    children: [{ topicName: 'myTopic', topicPublish: true, queueName: 'TOPIC.ORIGINAL.QUEUE' }]
                };

                const tree = await builder.build(app);
                assert.equal(tree.children[0].name, 'TOPIC.ORIGINAL.QUEUE');
                assert.ok(tree.children[0].metadata_lines.some(line => line.text.includes('topicPublishResolver errored out')));
                assert.ok(consoleErrors.length > 0);
            } finally {
                console.error = consoleErrorOriginal;
            }
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
