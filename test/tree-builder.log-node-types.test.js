/**
 * Unit tests for LogDecider
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder, LogDecider } from '../tree-builder.js';

describe('TreeBuilder', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
    });

    describe('LogDecider', () => {
        it('should not add Logs metadata_line when no LogDecider is set', async () => {
            builder.defineFunctions({ myFunc: {} });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines, undefined);
        });

        it('should not add Logs when LogDecider has empty node types', async () => {
            builder.setLogDecider(new LogDecider([]));
            builder.defineFunctions({ myFunc: {} });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            assert.equal(tree.children[0].metadata_lines, undefined);
        });

        it('should prepend Logs metadata_line to function nodes when configured', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({ myFunc: {} });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            assert.ok(func.metadata_lines, 'Should have metadata_lines');
            assert.equal(func.metadata_lines.length, 1);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[0].clickable, true);
            assert.deepEqual(func.metadata_lines[0].data, { name: 'myFunc', type: 'function' });
        });

        it('should prepend Logs before existing metadata_lines', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                myFunc: { metadata_lines: [{ text: 'existing' }] }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines.length, 2);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[1].text, 'existing');
        });

        it('should prepend Logs before app metadata_line on function nodes', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                myFunc: { app: 'MyApp' }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines.length, 2);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[0].clickable, true);
            assert.deepEqual(func.metadata_lines[0].data, { name: 'myFunc', type: 'function', app: 'MyApp' });
            assert.equal(func.metadata_lines[1].text, 'MyApp');
            assert.equal(func.metadata_lines[1].clickable, false);
        });

        it('should add Logs metadata_line to timer nodes at app level when configured', async () => {
            builder.setLogDecider(new LogDecider(['timer']));
            builder.defineFunctions({ asyncFunc: {} });
            const app = {
                name: 'test-app', type: 'app',
                children: [{ ref: 'asyncFunc', async: true, queueName: 'Q.NAME' }]
            };
            const tree = await builder.build(app);
            assert.equal(tree.children[0].type, 'timer');
            assert.ok(tree.children[0].metadata_lines);
            assert.equal(tree.children[0].metadata_lines[0].text, 'Logs');
            assert.equal(tree.children[0].metadata_lines[0].clickable, true);
            assert.deepEqual(tree.children[0].metadata_lines[0].data, { name: 'Q.NAME', type: 'timer' });
        });

        it('should add Logs metadata_line to app nodes when configured', async () => {
            builder.setLogDecider(new LogDecider(['app']));
            const app = { name: 'test-app', type: 'app', children: [] };
            const tree = await builder.build(app);
            assert.ok(tree.metadata_lines);
            assert.equal(tree.metadata_lines[0].text, 'Logs');
            assert.equal(tree.metadata_lines[0].clickable, true);
            assert.deepEqual(tree.metadata_lines[0].data, { name: 'test-app', type: 'app' });
        });

        it('should add Logs metadata_line to ui-service-method nodes when configured', async () => {
            builder.setLogDecider(new LogDecider(['ui-service-method']));
            const app = {
                name: 'test-app', type: 'app',
                children: [{
                    name: 'ServiceGroup', type: 'ui-services',
                    children: [{ name: 'method1', type: 'ui-service-method', children: [] }]
                }]
            };
            const tree = await builder.build(app);
            const method = tree.children[0].children[0];
            assert.ok(method.metadata_lines);
            assert.equal(method.metadata_lines[0].text, 'Logs');
            assert.equal(method.metadata_lines[0].clickable, true);
            assert.deepEqual(method.metadata_lines[0].data, { name: 'method1', type: 'ui-service-method' });
        });

        it('should add Logs to multiple node types when configured', async () => {
            builder.setLogDecider(new LogDecider(['function', 'timer']));
            builder.defineFunctions({ myFunc: {} });
            const app = {
                name: 'test-app', type: 'app',
                children: [
                    { ref: 'myFunc' },
                    { ref: 'myFunc', async: true, queueName: 'Q.TEST' }
                ]
            };
            const tree = await builder.build(app);
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
            builder.setLogDecider(new LogDecider(['dupe-stopper', 'function']));
            builder.defineFunctions({
                funcA: { children: [{ ref: 'funcB' }] },
                funcB: { children: [{ ref: 'funcA' }] }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'funcA' }] };
            const tree = await builder.build(app);
            // funcA -> funcB -> dupe-stopper(funcA)
            const dupeStopper = tree.children[0].children[0].children[0];
            assert.equal(dupeStopper.type, 'dupe-stopper');
            assert.equal(dupeStopper.metadata_lines, undefined);
        });

        it('should add Logs to timer nodes inside function subtrees (pre-resolution)', async () => {
            builder.setLogDecider(new LogDecider(['timer']));
            builder.defineFunctions({
                innerAsync: {},
                parentFunc: {
                    children: [{ ref: 'innerAsync', async: true, queueName: 'INNER.Q' }]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'parentFunc' }] };
            const tree = await builder.build(app);
            // parentFunc -> timer(INNER.Q) -> innerAsync
            const timerNode = tree.children[0].children[0];
            assert.equal(timerNode.type, 'timer');
            assert.equal(timerNode.name, 'INNER.Q');
            assert.ok(timerNode.metadata_lines, 'Timer inside function subtree should have Logs');
            assert.equal(timerNode.metadata_lines[0].text, 'Logs');
            assert.deepEqual(timerNode.metadata_lines[0].data, { name: 'INNER.Q', type: 'timer' });
        });

        it('should add Logs to topic nodes inside function subtrees (pre-resolution)', async () => {
            builder.setLogDecider(new LogDecider(['topic']));
            builder.defineFunctions({
                parentFunc: {
                    children: [{ topicPublish: true, topicName: 'myEvent', queueName: 'EVENT.Q' }]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'parentFunc' }] };
            const tree = await builder.build(app);
            const topicNode = tree.children[0].children[0];
            assert.equal(topicNode.type, 'topic');
            assert.ok(topicNode.metadata_lines, 'Topic inside function subtree should have Logs');
            assert.equal(topicNode.metadata_lines[0].text, 'Logs');
            assert.deepEqual(topicNode.metadata_lines[0].data, { name: 'EVENT.Q', type: 'topic' });
        });

        it('should include app in data when present on function node', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                myFunc: { app: 'TestApp' }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines[0].data.app, 'TestApp');
        });

        it('should not include app in data when not present on function node', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                myFunc: {}
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            assert.equal(func.metadata_lines[0].data.app, undefined);
        });

        it('should handle Logs with app and existing metadata_lines combined', async () => {
            builder.setLogDecider(new LogDecider(['function']));
            builder.defineFunctions({
                myFunc: {
                    app: 'MyApp',
                    metadata_lines: [{ text: 'DB: TABLE', clickable: true, data: { table: 'T' } }]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'myFunc' }] };
            const tree = await builder.build(app);
            const func = tree.children[0];
            // Order: Logs, app metadata_line, existing metadata_line
            assert.equal(func.metadata_lines.length, 3);
            assert.equal(func.metadata_lines[0].text, 'Logs');
            assert.equal(func.metadata_lines[0].data.app, 'MyApp');
            assert.equal(func.metadata_lines[1].text, 'MyApp');
            assert.equal(func.metadata_lines[1].clickable, false);
            assert.equal(func.metadata_lines[2].text, 'DB: TABLE');
        });

        it('should pass resolvedProps and resolverName to decide() for topic nodes', async () => {
            const decideCalls = [];
            class SpyLogDecider extends LogDecider {
                decide(node, context) {
                    decideCalls.push({ nodeType: node.type, nodeName: node.name, context });
                    return super.decide(node, context);
                }
            }

            builder.setLogDecider(new SpyLogDecider(['topic']));
            builder.setTopicPublishResolver((topicName) => {
                return { queueName: 'RESOLVED.TOPIC.Q' };
            });
            builder.defineFunctions({
                parentFunc: {
                    children: [{ topicPublish: true, topicName: 'myEvent' }]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'parentFunc' }] };
            await builder.build(app);

            // Find the topic decide call (pre-resolution phase)
            const topicCall = decideCalls.find(c => c.nodeType === 'topic');
            assert.ok(topicCall, 'decide() should have been called for topic node');
            assert.equal(topicCall.context.resolverName, 'topicPublishResolver');
            assert.deepEqual(topicCall.context.resolvedProps, { queueName: 'RESOLVED.TOPIC.Q' });
        });

        it('should pass resolvedProps and resolverName to decide() for async timer nodes', async () => {
            const decideCalls = [];
            class SpyLogDecider extends LogDecider {
                decide(node, context) {
                    decideCalls.push({ nodeType: node.type, nodeName: node.name, context });
                    return super.decide(node, context);
                }
            }

            builder.setLogDecider(new SpyLogDecider(['timer']));
            builder.setAsyncResolver((ref, queueName) => {
                return { queueName: 'RESOLVED.ASYNC.Q', depth: 3 };
            });
            builder.defineFunctions({
                parentFunc: {
                    children: [{ ref: 'childFunc', async: true, queueName: 'ORIG.Q' }]
                },
                childFunc: {}
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'parentFunc' }] };
            await builder.build(app);

            // Find the timer decide call (pre-resolution phase)
            const timerCall = decideCalls.find(c => c.nodeType === 'timer');
            assert.ok(timerCall, 'decide() should have been called for timer node');
            assert.equal(timerCall.context.resolverName, 'asyncResolver');
            assert.deepEqual(timerCall.context.resolvedProps, { queueName: 'RESOLVED.ASYNC.Q', depth: 3 });
        });

        it('should support custom LogDecider subclass for conditional topic logging', async () => {
            // Custom decider: only log topic nodes if the resolver resolved a queueName
            class ConditionalTopicDecider extends LogDecider {
                decide(node, context = {}) {
                    if (!super.decide(node, context)) return false;
                    if (node.type === 'topic') {
                        return context.resolvedProps?.queueName != null;
                    }
                    return true;
                }
            }

            // Topic WITH resolver that returns queueName
            builder.setLogDecider(new ConditionalTopicDecider(['topic']));
            builder.setTopicPublishResolver((topicName) => {
                if (topicName === 'resolvedTopic') {
                    return { queueName: 'RESOLVED.Q' };
                }
                return null; // not resolved
            });
            builder.defineFunctions({
                parentFunc: {
                    children: [
                        { topicPublish: true, topicName: 'resolvedTopic' },
                        { topicPublish: true, topicName: 'unresolvedTopic', queueName: 'FALLBACK.Q' }
                    ]
                }
            });
            const app = { name: 'test-app', type: 'app', children: [{ ref: 'parentFunc' }] };
            const tree = await builder.build(app);

            const resolvedTopicNode = tree.children[0].children[0];
            const unresolvedTopicNode = tree.children[0].children[1];

            // Resolved topic should have Logs
            assert.equal(resolvedTopicNode.type, 'topic');
            assert.equal(resolvedTopicNode.name, 'RESOLVED.Q');
            assert.ok(resolvedTopicNode.metadata_lines, 'Resolved topic should have Logs metadata_line');
            assert.equal(resolvedTopicNode.metadata_lines[0].text, 'Logs');

            // Unresolved topic should NOT have Logs
            assert.equal(unresolvedTopicNode.type, 'topic');
            assert.equal(unresolvedTopicNode.name, 'FALLBACK.Q');
            assert.equal(unresolvedTopicNode.metadata_lines, undefined, 'Unresolved topic should not have Logs metadata_line');
        });

        it('should support setLogDecider chaining', () => {
            const result = builder.setLogDecider(new LogDecider(['function']));
            assert.equal(result, builder, 'setLogDecider should return this for chaining');
        });
    });

});
