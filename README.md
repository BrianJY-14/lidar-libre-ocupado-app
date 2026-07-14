# LiDAR Libre/Ocupado - App de despliegue

Aplicacion web estatica para demostrar el modelo final del proyecto:
Decision Tree, radio de soporte `R = 3.0 m`, validado con Leave-One-Scene-Out.

La app corre la inferencia en el navegador usando un arbol exportado a JSON.
Incluye dos modos:

- Simulacion diferida con frames reales: `libre_01 -> ocupado_06`, 10 Hz,
  alerta filtrada 3-de-5 frames.
- Prueba manual de archivos `.npy` del ROI (`float32`, shape `(N, 3)`), con
  extraccion de features geometricas equivalente a `CODIGO/lidar_features.py`.

## Uso local

Desde esta carpeta:

```powershell
npm run dev
```

Abrir `http://localhost:5173`.

## Vercel

Configurar esta carpeta (`APP_LIDAR_DESPLIEGUE`) como root del proyecto en
Vercel. Comando de build recomendado: `npm run build`.
