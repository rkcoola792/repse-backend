const bcrypt = require("bcrypt");

// Sync bcrypt calls block Node's single event loop for the full hash duration,
// stalling every other in-flight request — the async variants run on the
// libuv thread pool instead.
const createHash = async (password) => {
  try {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
  } catch (error) {
    console.error("Error creating hash: ", error);
    throw error;
  }
};

const compareHash = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};
module.exports = { createHash, compareHash };
