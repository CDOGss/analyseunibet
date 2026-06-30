import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { exec } from 'child_process'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'run-analysis-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/run-analysis' && req.method === 'POST') {
            exec('node scripts/daily_analysis.js', (error, stdout, stderr) => {
              res.setHeader('Content-Type', 'application/json');
              if (error) {
                console.error("Erreur de script :", error);
                res.statusCode = 500;
                res.end(JSON.stringify({ error: error.message, stderr }));
                return;
              }
              res.end(JSON.stringify({ success: true, stdout }));
            });
          } else {
            next();
          }
        });
      }
    }
  ],
})
