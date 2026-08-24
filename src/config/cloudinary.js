const cloudinary = require("cloudinary").v2;

// The SDK reads cloud_name/api_key/api_secret straight out of
// process.env.CLOUDINARY_URL when config() is called with no arguments.
cloudinary.config();

module.exports = cloudinary;
