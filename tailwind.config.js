// Tailwind settings for tools/build-css.sh. The app used the Tailwind CDN before; this builds the same utilities once,
// into tailwind.css, so phones do not download and run the CDN compiler on every visit.
module.exports = {
    content: ['./index.html', './js/**/*.js'],
    theme: { extend: {} },
    plugins: []
};
