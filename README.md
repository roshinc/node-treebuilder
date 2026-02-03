# node-treebuilder

A Node.js utility for building hierarchical tree structures from application and function pool definitions. Supports sync/async function references, topic publishing, and cycle detection.

## Installation

```bash
npm install
```

## Usage

### Using JSON Configuration (Recommended)

Load app and function configurations from JSON files:

```javascript
import { TreeBuilder } from './tree-builder.js';
import {
    loadApp,
    loadFunctionPoolFromDirectory,
    getDefaultConfigDir,
    getDefaultAppsDir
} from './json-loader.js';

// Load function pool (shared across all apps)
const functionPool = await loadFunctionPoolFromDirectory(getDefaultConfigDir());

// Load a specific app config
const appConfig = await loadApp('nims-exceptions-app', getDefaultAppsDir());

// Build the tree
const builder = new TreeBuilder();
builder.defineFunctions(functionPool);
const tree = await builder.build(appConfig);

console.log(JSON.stringify(tree, null, 2));
```

### Using JavaScript Configuration

```javascript
import { TreeBuilder, ref, asyncRef, topicPublishRef } from './tree-builder.js';

const builder = new TreeBuilder();

// Define functions
builder.defineFunctions({
    'childFunc': {},
    'parentFunc': {
        children: [ref('childFunc')]
    }
});

// Build tree from app structure
const tree = await builder.build({
    name: 'my-app',
    type: 'app',
    children: [
        { ref: 'parentFunc' }
    ]
});
```

## JSON Configuration Format

### App Configuration (`config/apps/*.json`)

Each app is stored as a separate JSON file:

```json
{
    "name": "my-app",
    "type": "app",
    "children": [
        { "ref": "functionName" },
        { "ref": "asyncFunction", "async": true, "queueName": "QUEUE.NAME" },
        {
            "name": "ServiceGroup",
            "type": "ui-services",
            "children": [
                {
                    "name": "methodName",
                    "type": "ui-service-method",
                    "children": [
                        { "ref": "helperFunction" }
                    ]
                }
            ]
        }
    ]
}
```

### Function Pool (`config/functionPool.json`)

```json
{
    "leafFunction": {},
    "parentFunction": {
        "children": [
            { "ref": "leafFunction" }
        ]
    },
    "publisherFunction": {
        "children": [
            { "topicName": "eventName", "topicPublish": true }
        ]
    }
}
```

### Reference Types

| Type | JSON Format | Description |
|------|-------------|-------------|
| Sync | `{ "ref": "funcName" }` | Direct function reference |
| Async | `{ "ref": "funcName", "async": true, "queueName": "Q.NAME" }` | Wrapped in timer/queue node |
| Topic | `{ "topicName": "event", "topicPublish": true, "queueName": "Q.NAME" }` | Publish to topic (queueName optional) |

### Metadata Lines

Any node can include `metadata_lines` - an array of metadata objects that will be preserved in the output tree. This is useful for attaching additional display information to nodes.

```json
{
    "name": "myFunction",
    "type": "function",
    "metadata_lines": [
        {
            "text": "Log: MY_LOG",
            "clickable": true,
            "data": {
                "logType": "MY_LOG",
                "customField": "value"
            }
        },
        {
            "text": "Just a label"
        }
    ]
}
```

**Properties:**
| Property | Required | Description |
|----------|----------|-------------|
| `text` | Yes | Display text for the metadata line |
| `clickable` | No | If `true`, the line is rendered as a clickable link |
| `data` | No | Arbitrary data object attached to this metadata line |

**Example in function pool:**
```json
{
    "createWtException": {
        "metadata_lines": [
            { "text": "Creates WT exceptions" },
            { "text": "Log: WT_EXCEPTION", "clickable": true, "data": { "logType": "WT_EXCEPTION" } }
        ],
        "children": [
            { "ref": "retrieveExceptionDefMetaData" }
        ]
    }
}
```

## Project Structure

```
├── tree-builder.js      # Core TreeBuilder class
├── json-loader.js       # JSON configuration loader
├── config/
│   ├── functionPool.json    # Function definitions
│   └── apps/                # Individual app configs
│       ├── nims-exceptions-app.json
│       ├── nims-wt-pend-process-app.json
│       ├── nims-wt-wage-process-app.json
│       └── nims-wt-file-process-app.json
├── test/
│   ├── tree-builder.test.js
│   └── json-loader.test.js
├── example.js           # JavaScript config example
└── example-json.js      # JSON config example
```

## API

### TreeBuilder

```javascript
const builder = new TreeBuilder();

// Define functions
builder.defineFunction(name, children?, extraProps?);
builder.defineFunctions(functionPoolObject);

// Set resolvers for async/topic references
builder.setAsyncResolver((funcName, queueName) => ({ queueName, depth }));
builder.setTopicPublishResolver((topicName, queueName) => ({ queueName }));

// Build tree
const tree = await builder.build(appStructure);
```

### JSON Loader

```javascript
// Load single app by name
const app = await loadApp('app-name', appsDir);

// Load from URL (REST API)
const app = await loadAppFromUrl('https://api.example.com/apps/app-name');

// Load function pool
const pool = await loadFunctionPoolFromDirectory(configDir);
const pool = await loadFunctionPool('https://api.example.com/functionPool');

// List available apps
const apps = await listAvailableApps(appsDir);

// Validation
validateApp(appConfig);
validateFunctionPool(poolConfig);
```

## Running Examples

```bash
# JavaScript-based configuration
npm start

# JSON-based configuration
node example-json.js
```

## Testing

```bash
npm test
```

Runs 59 unit tests covering TreeBuilder and JSON loader functionality.

## License

ISC
