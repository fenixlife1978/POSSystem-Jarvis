# Sistema POS - Mi Empresa, C.A.

Sistema Punto de Venta (POS) estilo aplicación de escritorio Windows clásico, replicando exactamente las interfaces de las imágenes de referencia.

## Estructura

```
pos/
├── index.html          # Ventana principal POS + todos los módulos
├── css/
│   ├── main.css        # Estilo base tipo Windows XP
│   ├── pos.css         # POS Venta (imagen 1)
│   ├── clientes.css    # Módulo Clientes
│   ├── productos.css   # Módulo Productos
│   ├── cotizaciones.css
│   ├── devoluciones.css
│   ├── caja.css
│   ├── compras.css
│   ├── inventario.css
│   └── reportes.css
├── js/
│   ├── data.js         # Datos de muestra (clientes, productos, etc.)
│   ├── pos.js          # Lógica del POS
│   └── modules.js      # Render de los módulos
└── img/                # (íconos embebidos vía emoji Unicode)
```

## Cómo ejecutar

Opción 1 (rápida):
```bash
cd pos
python3 -m http.server 8000
# Abrir http://localhost:8000
```

Opción 2:
Solo abrir `index.html` en cualquier navegador moderno.

## Módulos incluidos

1. **Punto de Venta (POS)** — Réplica exacta de la imagen 1
   - Cliente, Detalle de venta, Agregar producto, Totales, Forma de pago
2. **Clientes** — Réplica imagen 2
3. **Productos** — Réplica imagen 2
4. **Cotizaciones** — Réplica imagen 2
5. **Devoluciones** — Réplica imagen 2
6. **Caja (Movimiento de Caja)** — Réplica imagen 2
7. **Compras** — Réplica imagen 2
8. **Inventario (Existencias)** — Réplica imagen 2
9. **Reportes** — Réplica imagen 2 (incluye 8 categorías con sub-reportes)

## Atajos de teclado

- F2 - Nueva Venta
- F3 - Buscar Producto / enfoca código
- F4 - Cliente
- F5 - Cotización / Crédito
- F6 - Devolución
- F7 - Anular venta
- F8 - Descuento
- F9 - Efectivo
- F10 - Tarjeta
- F11 - Mixto
- F12 - Salir
- Enter (en campos de producto) - Agregar al carrito
