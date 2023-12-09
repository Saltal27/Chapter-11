var bigOak = require("./crow-tech").bigOak;

var defineRequestType = require("./crow-tech").defineRequestType;

defineRequestType("note", (nest, content, source, done) => {
    console.log(`${nest.name} received note: ${content}`);
    done();
});

/**
 * Reads data from storage
 * @param {object} nest - The nest to read from
 * @param {string} name - The name of the data to read
 * @returns {Promise} - A promise that resolves with the result
 */
function storage(nest, name) {
    return new Promise(resolve => {
        nest.readStorage(name, result => resolve(result));
    });
}

var Timeout = class Timeout extends Error {}

/**
 * Sends a request to a target nest
 * @param {object} nest - The nest sending the request
 * @param {string} target - The target nest
 * @param {string} type - The type of request
 * @param {any} content - The content of the request
 * @returns {Promise} - A promise that resolves with the response or rejects with an error
 */
function request(nest, target, type, content) {
    return new Promise((resolve, reject) => {
        let done = false;

        function attempt(n) {
            nest.send(target, type, content, (failed, value) => {
                done = true;
                if (failed) reject(failed);
                else resolve(value);
            });
            setTimeout(() => {
                if (done) return;
                else if (n < 3) attempt(n + 1);
                else reject(new Timeout("Timed out"));
            }, 250);
        }
        attempt(1);
    });
}

/**
 * Defines a new type of request with a handler function
 * @param {string} name - The name of the request type
 * @param {function} handler - The function to handle the request
 */
function requestType(name, handler) {
    defineRequestType(name, (nest, content, source, callback) => {
        try {
            Promise.resolve(handler(nest, content, source))
                .then(response => callback(null, response),
                    failure => callback(failure));
        } catch (exception) {
            callback(exception);
        }
    });
}

requestType("ping", () => "pong");

/**
 * Finds available neighbors for a nest
 * @param {object} nest - The nest to find neighbors for
 * @returns {Promise} - A promise that resolves with the available neighbors
 */
function availableNeighbors(nest) {
    let requests = nest.neighbors.map(neighbor => {
        return request(nest, neighbor, "ping")
            .then(() => true, () => false);
    });
    return Promise.all(requests).then(result => {
        return nest.neighbors.filter((_, i) => result[i]);
    });
}

var everywhere = require("./crow-tech").everywhere;

everywhere(nest => {
    nest.state.gossip = [];
});

/**
 * Sends gossip to neighbors
 * @param {object} nest - The nest sending the gossip
 * @param {string} message - The gossip message
 * @param {object} exceptFor - The neighbor to exclude from receiving the gossip
 */
function sendGossip(nest, message, exceptFor = null) {
    nest.state.gossip.push(message);
    for (let neighbor of nest.neighbors) {
        if (neighbor == exceptFor) continue;
        request(nest, neighbor, "gossip", message);
    }
}

requestType("gossip", (nest, message, source) => {
    if (nest.state.gossip.includes(message)) return;
    console.log(`${nest.name} received gossip '${message}' from ${source}`);
    sendGossip(nest, message, source);
});

requestType("connections", (nest, {
    name,
    neighbors
}, source) => {
    let connections = nest.state.connections;
    if (JSON.stringify(connections.get(name)) ==
        JSON.stringify(neighbors)) return;
    connections.set(name, neighbors);
    broadcastConnections(nest, name, source);
});

/**
 * Broadcasts connections to neighbors
 * @param {object} nest - The nest sending the connections
 * @param {string} name - The name of the nest
 * @param {object} exceptFor - The neighbor to exclude from receiving the connections
 */
function broadcastConnections(nest, name, exceptFor = null) {
    for (let neighbor of nest.neighbors) {
        if (neighbor == exceptFor) continue;
        request(nest, neighbor, "connections", {
            name,
            neighbors: nest.state.connections.get(name)
        });
    }
}

everywhere(nest => {
    nest.state.connections = new Map();
    nest.state.connections.set(nest.name, nest.neighbors);
    broadcastConnections(nest, nest.name);
});

/**
 * Finds a route from one nest to another using the given connections
 * @param {string} from - The name of the nest to start from
 * @param {string} to - The name of the nest to find a route to
 * @param {object} connections - The connections between nests
 * @returns {string|null} - The name of the next nest in the route, or null if no route was found
 */
function findRoute(from, to, connections) {
    let work = [{
        at: from,
        via: null
    }];
    for (let i = 0; i < work.length; i++) {
        let {
            at,
            via
        } = work[i];
        for (let next of connections.get(at) || []) {
            if (next == to) return via;
            if (!work.some(w => w.at == next)) {
                work.push({
                    at: next,
                    via: via || next
                });
            }
        }
    }
    return null;
}

/**
 * Routes a request to the target nest
 * @param {object} nest - The nest sending the request
 * @param {string} target - The name of the target nest
 * @param {string} type - The type of request
 * @param {object} content - The content of the request
 * @returns {Promise} - A promise that resolves with the response from the target nest
 */
function routeRequest(nest, target, type, content) {
    if (nest.neighbors.includes(target)) {
        return request(nest, target, type, content);
    } else {
        let via = findRoute(nest.name, target,
            nest.state.connections);
        if (!via) throw new Error(`No route to ${target}`);
        return request(nest, via, "route", {
            target,
            type,
            content
        });
    }
}

requestType("route", (nest, {
    target,
    type,
    content
}) => {
    return routeRequest(nest, target, type, content);
});

requestType("storage", (nest, name) => storage(nest, name));

/**
 * Finds an item in the local storage of a nest, and if not found, searches in remote storage
 * @param {object} nest - The nest to search in
 * @param {string} name - The name of the item to find
 * @returns {Promise} - A promise that resolves with the found item or rejects if not found
 */
function findInStorage(nest, name) {
    return storage(nest, name).then(found => {
        if (found != null) return found;
        else return findInRemoteStorage(nest, name);
    });
}

/**
 * Retrieves the list of all connected nests in the network
 * @param {object} nest - The nest to retrieve the network for
 * @returns {string[]} - An array of names of all connected nests
 */
function network(nest) {
    return Array.from(nest.state.connections.keys());
}

/**
 * Finds an item in the remote storage of a network by recursively trying different sources
 * @param {object} nest - The nest to search from
 * @param {string} name - The name of the item to find
 * @returns {Promise} - A promise that resolves with the found item or rejects if not found
 */
function findInRemoteStorage(nest, name) {
    let sources = network(nest).filter(n => n != nest.name);

    /**
     * Recursively finds the next available source to retrieve an item from storage
     * @returns {Promise} - A promise that resolves with the retrieved item or rejects if not found
     */
    function next() {
        if (sources.length == 0) {
            return Promise.reject(new Error("Not found"));
        } else {
            let source = sources[Math.floor(Math.random() * sources.length)];
            sources = sources.filter(n => n != source);
            return routeRequest(nest, source, "storage", name)
                .then(value => value != null ? value : next(), next);
        }
    }
    return next();
}

/**
 * Represents a group of members
 */
var Group = class Group {
    constructor() {
        this.members = [];
    }
    /**
     * Adds a member to the group
     * @param {object} m - The member to add to the group
     */
    add(m) {
        this.members.add(m);
    }
}

/**
 * Retrieves an item from storage of a given nest, or from remote storage if the source is different
 * @param {object} nest - The nest to retrieve the item from
 * @param {string} source - The source nest to retrieve the item from
 * @param {string} name - The name of the item to retrieve
 * @returns {Promise} - A promise that resolves with the retrieved item
 */
function anyStorage(nest, source, name) {
    if (source == nest.name) return storage(nest, name);
    else return routeRequest(nest, source, "storage", name);
}

/**
 * Retrieves a list of chicks in a given year from all connected nests
 * @param {object} nest - The nest to retrieve the list from
 * @param {number} year - The year to retrieve the chicks for
 * @returns {Promise} - A promise that resolves with the list of chicks
 */
async function chicks(nest, year) {
    let list = "";
    await Promise.all(network(nest).map(async name => {
        list += `${name}: ${
      await anyStorage(nest, name, `chicks in ${year}`)
    }\n`;
    }));
    return list;
}

let nests = [];
everywhere(nest => {
    nests.push(nest);
});

async function locateScalpel(nest) {
    let scalpelLastLocation = await storage(nest, "scalpel");
    if (scalpelLastLocation == nest.name) {
        return scalpelLastLocation;
    } else {
        let nextNest = nests.filter(n => {return n.name == scalpelLastLocation})[0];
        return locateScalpel(nextNest); 
    }
}

function locateScalpel2(nest) {
    return new Promise(resolve => resolve(storage(nest, "scalpel")))
    .then((scalpelLastLocation) => {
        if (scalpelLastLocation == nest.name) {
            return scalpelLastLocation;
        } else {
            let nextNest = nests.filter(n => {return n.name == scalpelLastLocation})[0];
            return locateScalpel2(nextNest); 
        }
    })
}

locateScalpel(nests[0]).then(console.log);
locateScalpel2(nests[0]).then(console.log);
