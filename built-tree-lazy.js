function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (value && typeof value === 'object') {
    const cloned = {};
    for (const [key, childValue] of Object.entries(value)) {
      cloned[key] = cloneValue(childValue);
    }
    return cloned;
  }

  return value;
}

function cloneNodeWithoutChildren(node) {
  const cloned = {};
  for (const [key, value] of Object.entries(node || {})) {
    if (key === 'children' || key === 'loadChildren') {
      continue;
    }
    cloned[key] = cloneValue(value);
  }
  return cloned;
}

function hasChildren(node) {
  return Array.isArray(node?.children) && node.children.length > 0;
}

function isWrapperType(type) {
  return type === 'timer' || type === 'queue' || type === 'topic';
}

function prepareNode(node, parentNodeId, nextIdRef) {
  const prepared = cloneNodeWithoutChildren(node);
  const nodeId = nextIdRef.value++;
  prepared._nodeId = nodeId;

  if (parentNodeId !== undefined) {
    prepared._parentNodeId = parentNodeId;
  }

  if (Array.isArray(node?.children)) {
    prepared.children = node.children.map(child => prepareNode(child, nodeId, nextIdRef));
  }

  return prepared;
}

function projectContainer(node) {
  const projected = cloneNodeWithoutChildren(node);
  if (!hasChildren(node)) {
    return projected;
  }

  projected.children = node.children.map(projectContainerChild);
  return projected;
}

function projectContainerChild(child) {
  if (child?.type === 'function') {
    return projectFunctionShallow(child);
  }

  if (isWrapperType(child?.type)) {
    return projectWrapper(child, projectContainerChild);
  }

  if (hasChildren(child)) {
    return projectContainer(child);
  }

  return cloneNodeWithoutChildren(child);
}

function projectFunctionShallow(node) {
  if (node?.type !== 'function') {
    return projectSelectedRoot(node);
  }

  const projected = cloneNodeWithoutChildren(node);
  if (!hasChildren(node)) {
    return projected;
  }

  projected.children = node.children.map(projectFunctionChild);
  return projected;
}

function projectFunctionChild(child) {
  if (child?.type === 'function') {
    return projectFunctionLeafOrLoadable(child);
  }

  if (isWrapperType(child?.type)) {
    return projectWrapper(child, projectFunctionChild);
  }

  return cloneValue(child);
}

function projectFunctionLeafOrLoadable(node) {
  if (node?.type !== 'function') {
    return cloneNodeWithoutChildren(node);
  }

  const projected = cloneNodeWithoutChildren(node);
  if (hasChildren(node)) {
    projected.loadChildren = true;
  }
  return projected;
}

function projectWrapper(node, childProjector) {
  const projected = cloneNodeWithoutChildren(node);
  if ((node?.type === 'timer' || node?.type === 'topic') && !Object.hasOwn(node || {}, 'queueName')) {
    projected.queueName = undefined;
  }

  if (!hasChildren(node)) {
    return projected;
  }

  projected.children = node.children.map(childProjector);
  return projected;
}

function projectSelectedRoot(node) {
  if (node?.type === 'function') {
    return projectFunctionShallow(node);
  }

  if (hasChildren(node)) {
    return projectContainer(node);
  }

  return cloneNodeWithoutChildren(node);
}

function findNodeById(node, nodeId) {
  if (!node || node._nodeId === nodeId) {
    return node || null;
  }

  if (!Array.isArray(node.children)) {
    return null;
  }

  for (const child of node.children) {
    const match = findNodeById(child, nodeId);
    if (match) {
      return match;
    }
  }

  return null;
}

function prepareBuiltTree(fullTree) {
  return prepareNode(fullTree, undefined, { value: 1 });
}

function get(preparedTree) {
  return projectContainer(preparedTree);
}

function getFrom(preparedTree, nodeId) {
  const match = findNodeById(preparedTree, nodeId);
  if (!match) {
    throw new Error(`Node with id "${nodeId}" was not found in the prepared tree.`);
  }

  return projectSelectedRoot(match);
}

export { prepareBuiltTree, get, getFrom };
