/**
 * Unit tests for TreeBuilder
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TreeBuilder } from '../tree-builder.js';

describe('TreeBuilder', () => {
    let builder;

    beforeEach(() => {
        builder = new TreeBuilder();
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
