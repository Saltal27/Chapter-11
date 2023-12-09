const promises = [
    new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve('Promise 1 resolved');
        }, 2000);
    }),
    new Promise((resolve, reject) => {
        setTimeout(() => {
            reject('Promise 2 rejected');
        }, 3000);
    }),
    new Promise((resolve, reject) => {
        setTimeout(() => {
            resolve('Promise 3 resolved');
        }, 1000);
    })
];


/**
 * Returns a promise that waits for all of the promises in the input array to finish.
 * It succeeds, yielding an array of result values. If a promise in the array fails, 
 * the promise returned by Promise_all fails too, with the failure reason from the failing promise.
 * @param {Array<Promise>} promises - An array of promises to wait for.
 * @returns {Promise} - A promise that resolves to an array of results when all input promises have resolved, 
 * or rejects with the reason of the first promise that rejects.
 */
function Promise_all(promises) {
    return new Promise((resolve, reject) => {
        let results = [];
        let remaining = promises.length;
        // If the input array of promises is empty, resolve the new Promise immediately with an empty results array
        if (remaining === 0) {
            resolve(results);
        } else {
            // Iterate through the input array of promises
            for (let i = 0; i < promises.length; i++) {
                promises[i]
                    .then((result) => {
                        // When a promise resolves, store the resolved value in the results array
                        results[i] = result;
                        remaining--;
                        // If all promises have resolved, resolve the new Promise with the results array
                        if (remaining === 0) {
                            resolve(results);
                        }
                    })
                    .catch((error) => {
                        // If any promise in the input array rejects, immediately reject the new Promise with the rejection reason
                        reject(error);
                    });
            }
        }
    });
}

Promise_all(promises).then(console.log).catch(console.log);

