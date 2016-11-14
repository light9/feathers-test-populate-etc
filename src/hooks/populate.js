
const util = require('util');
const errors = require('feathers-errors');
const hooks = require('feathers-hooks-common/lib/utils');

const getDefaultPopulateSerialize = (populations, serializersByRoles) => hook => {
  const params = hook.params;
  
  if (params.populate) {
    params.populateDefn = populations[params.populate];
  }
  
  if (params.serialize) {
    params.serializerByRolesDefn = serializersByRoles[params.serialize];
  }
  
  return hook;
};

// Populate the data
const populate = (defn, where = 'result', name) => function (hook) {
  console.log(`\nPopulate data in hook.${where}${where === 'params' ? '.' + name : ''}`);
  const items = getPopulateInfo(hook, where, name);
  
  console.log(`There are ${items.length} items`);
  
  defn = defn || hook.params.populateDefn;
  if (typeof defn !== 'object') {
    throw new errors.BadRequest('Schema for populate not found.');
  }
  
  // The 'items' are being updated in place within 'hook'. IMPORTANT
  return populateItems(hook, items, defn, 0)
    .then(() => hook);
};

function populateItems(hook, items, includeDefn, depth) {
  const leader = getLeader(depth);
  
  return Promise.resolve()
    .then(() => {
      let permissions = includeDefn.permissions || ''; // todo array or split
      if (!depth && permissions) {
        if (!isPopulatePermitted(hook, hook.params.populate || null, permissions)) {
          throw new errors.BadRequest('Permissions do not allow this populate.');
        }
        console.log(`${leader}permissions verified for this populate.`);
      }
      
      if (includeDefn.include) {
        includeDefn = includeDefn.include;
      }
      
      if (!Array.isArray(items)) { // todo refactor after logs are no longer needed
        console.log(`${leader}populate the single item`);
        return populateItem(hook, items, includeDefn, depth + 1);
      }
      
      console.log(`${leader}which is an array`);
      /*
       return Promise.all(
       items.map(item => populateItem(item, includeDefn, depth))
       );
       */
      
      // populate an array sequentially to keep trace log sane
      var promise = Promise.resolve();
      var results = [];
  
      items.forEach((item, i) => {
        promise = promise
          .then(() => {
            console.log(`\n${leader}populate array element ${i}`);
            return populateItem(hook, item, includeDefn, depth + 1)
          });
      });
      
      return promise;
    });
}

function populateItem(hook, item, includeDefn, depth) {
  const leader = getLeader(depth);
  
  return Promise.resolve()
    .then(() => {
      
      // process children sequentially to keep trace log sane
      let promise = Promise.resolve();
      item._include = Object.keys(includeDefn);
      console.log(`\n${leader}save child names for depopulate: ${item._include.toString()}`);
      
      item._include.forEach(childName => {
        promise = promise
          .then(() => {
            console.log(`\n${leader}populate with child include: ${childName}`);
            return populateItemWithChild(hook, item, childName, includeDefn[childName], depth)
          });
      });
      
      return promise;
    });
}

function populateItemWithChild(hook, parentItem, childName, childDefn, depth) {
  const leader = getLeader(depth);
  
  const parentVal = hooks.getByDot(parentItem, childDefn.parentField);
  
  if (childDefn.select) {
    console.log(`${leader}evaluate 'select' function`);
  }
  
  var promise = Promise.resolve(childDefn.select ? childDefn.select(hook, parentItem) : {})
    .then(query => {
      const find = { query: childDefn.query || {} };
  
      if (Array.isArray(parentVal)) {
        console.log(`${leader}parent field is an array. match any value in it.`);
      }
      find.query[childDefn.childField] = Array.isArray(parentVal) ? { $in: parentVal } : parentVal;
  
      Object.assign(find.query, query); // dynamic options override static ones
  
      console.log(`${leader}${childDefn.service}.find(${util.inspect(find, { depth: 5, colors: true })})`);
  
      return hook.app.service(childDefn.service).find(find)
    })
    .then(result => {
      result = result.data || result;
      console.log(`${leader}${result.length} results found`);
      
      if (result.length === 1 && !childDefn.asArray) {
        console.log(`${leader}asArray=${childDefn.asArray}, so convert 1 elem array to object. `);
        result = result[0];
      }
      
      const nameAs = childDefn.nameAs || childName;
      parentItem[nameAs] = result;
  
      console.log(`${leader}Place results in parentItem.${nameAs}`);
      return parentItem[nameAs];
    });
  
  if (childDefn.include) {
    promise = promise
      .then(items => populateItems(hook, items, childDefn.include, depth))
  }
  
  return promise;
}

// Remove populated values from data
const dePopulate = (defn, where = 'data', name) => function (hook) {
  const items = getPopulateInfo(hook, where, name);
  
  (Array.isArray(items) ? items : [items]).forEach(item => {
    if ('_computed' in item) {
      item._computed.forEach(key => {
        if (key in item) {
          delete item[key];
        }
      });
  
      delete item._computed;
    }
  
    if ('_include' in item) {
      item._include.forEach(key => {
        if (key in item) {
          delete item[key];
        }
      });
      
      delete item._include;
    }
  });
  

  
  return hook;
};

// Helpers

// Common code for populate() and dePopulate()
function getPopulateInfo(hook, where, name) {
  let items = [];
  
  if (where === 'result') {
    items = hook.result.data || hook.result;
  } if (where === 'data') {
    items = hook.data;
  } if (where === 'params') {
    items = hook.params[name];
  }
  
  return items;
}

// Do permissions allow this populate to be run?
function isPopulatePermitted(hook, viewPopulateName, permissions) {
  return permissions === hook.params.permissions.serialize;
}

// Convert mongoose and Sequelize data to regular objects
function normalizeResult(obj) { // todo normalize results
  // If it's a mongoose model then
  if (typeof obj.toObject === 'function') {
    return obj.toObject();
  }
  // If it's a Sequelize model
  else if (typeof obj.toJSON === 'function') {
    return obj.toJSON();
  }
}

function getLeader(depth) {
  return '                                                                  '.substr(0, depth * 2);
}

module.exports = {
  getDefaultPopulateSerialize,
  populate,
  dePopulate,
};

function inspect(desc, obj) {
  console.log(desc);
  console.log(util.inspect(obj, { depth: 4, colors: true }));
  console.log('---');
}