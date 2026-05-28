import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const isCapacitor = process.env.CAPACITOR === 'true';
  return {
    base: isCapacitor || command === 'serve' ? './' : 'https://cdn.jsdelivr.net/gh/emunozgutier/archery-phone-tools@main/dist/',
    server: {
      host: true,
    },
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      ...(command === 'serve' ? [basicSsl()] : [])
    ],
  }
})

