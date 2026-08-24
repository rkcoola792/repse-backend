// Escapes regex special characters so user-supplied search text is matched
// literally instead of being interpreted as a pattern — untrusted input fed
// straight into $regex can be crafted to cause catastrophic backtracking
// (ReDoS) or match unintended fields.
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

module.exports = { escapeRegex };
