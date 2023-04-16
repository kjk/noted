import {
  collectNodesOfType,
  findNodeOfType,
  replaceNodesMatching,
} from "$sb/lib/tree.js";
export function parseQuery(queryTree) {
  replaceNodesMatching(queryTree, (n) => {
    if (!n.type) {
      const trimmed = n.text.trim();
      if (!trimmed) {
        return null;
      }
      n.text = trimmed;
    }
  });
  const queryNode = queryTree.children[0];
  const parsedQuery = {
    table: queryNode.children[0].children[0].text,
    filter: [],
  };
  const orderByNode = findNodeOfType(queryNode, "OrderClause");
  if (orderByNode) {
    const nameNode = findNodeOfType(orderByNode, "Name");
    parsedQuery.orderBy = nameNode.children[0].text;
    const orderNode = findNodeOfType(orderByNode, "OrderDirection");
    parsedQuery.orderDesc = orderNode
      ? orderNode.children[0].text === "desc"
      : false;
  }
  const limitNode = findNodeOfType(queryNode, "LimitClause");
  if (limitNode) {
    const nameNode = findNodeOfType(limitNode, "Number");
    parsedQuery.limit = valueNodeToVal(nameNode);
  }
  const filterNodes = collectNodesOfType(queryNode, "FilterExpr");
  for (const filterNode of filterNodes) {
    let val = void 0;
    const valNode = filterNode.children[2].children[0];
    val = valueNodeToVal(valNode);
    const f = {
      prop: filterNode.children[0].children[0].text,
      op: filterNode.children[1].text,
      value: val,
    };
    parsedQuery.filter.push(f);
  }
  const selectNode = findNodeOfType(queryNode, "SelectClause");
  if (selectNode) {
    parsedQuery.select = [];
    collectNodesOfType(selectNode, "Name").forEach((t) => {
      parsedQuery.select.push(t.children[0].text);
    });
  }
  const renderNode = findNodeOfType(queryNode, "RenderClause");
  if (renderNode) {
    let renderNameNode = findNodeOfType(renderNode, "PageRef");
    if (!renderNameNode) {
      renderNameNode = findNodeOfType(renderNode, "String");
    }
    parsedQuery.render = valueNodeToVal(renderNameNode);
  }
  return parsedQuery;
}
export function valueNodeToVal(valNode) {
  switch (valNode.type) {
    case "Number":
      return +valNode.children[0].text;
    case "Bool":
      return valNode.children[0].text === "true";
    case "Null":
      return null;
    case "Name":
      return valNode.children[0].text;
    case "Regex": {
      const val = valNode.children[0].text;
      return val.substring(1, val.length - 1);
    }
    case "String": {
      const stringVal = valNode.children[0].text;
      return stringVal.substring(1, stringVal.length - 1);
    }
    case "PageRef": {
      const pageRefVal = valNode.children[0].text;
      return pageRefVal.substring(2, pageRefVal.length - 2);
    }
    case "List": {
      return collectNodesOfType(valNode, "Value").map((t) =>
        valueNodeToVal(t.children[0])
      );
    }
  }
}
