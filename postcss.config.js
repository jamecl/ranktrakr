# Install the correct Tailwind PostCSS plugin
npm install @tailwindcss/postcss

# Update postcss.config.js
cat > postcss.config.js << 'EOF'
module.exports = {
  plugins: {
    '@tailwindcss/postcss': {},
    autoprefixer: {},
  },
}
EOF