import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  doc,
  updateDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// =========================================================
// 1. ESTADO DE LA APLICACIÓN EN LA NUBE (FIRESTORE)
// =========================================================
const productosIniciales = [
  { codigo: "FER-001", nombre: "Saco Cemento Gris 42.5kg", costo: 68.00, precio: 78.00, stock: 45, minimo: 10 },
  { codigo: "FER-002", nombre: "Martillo Carpintero Mango Madera", costo: 32.00, precio: 45.00, stock: 8, minimo: 5 },
  { codigo: "FER-003", nombre: "Tubo PVC 1/2\" Agua Potable 6m", costo: 18.50, precio: 25.00, stock: 3, minimo: 10 },
  { codigo: "FER-004", nombre: "Galón Pintura Látex Blanca", costo: 110.00, precio: 145.00, stock: 12, minimo: 4 },
  { codigo: "FER-005", nombre: "Libra Clavo de Acero 2.5\"", costo: 6.50, precio: 9.00, stock: 30, minimo: 10 },
  { codigo: "FER-006", nombre: "Llave Stilson 14\" Reforzada", costo: 75.00, precio: 98.00, stock: 2, minimo: 3 }
];

let productos = [];
let ventas = [];
let fiados = [];
let carrito = [];
let rolActual = "admin";

// Cargar datos semilla si la base de datos en Firestore está vacía
async function inicializarBaseDatos() {
  try {
    const snap = await getDocs(collection(db, "productos"));
    if (snap.empty) {
      for (const prod of productosIniciales) {
        await addDoc(collection(db, "productos"), prod);
      }
      console.log("Catálogo inicial cargado en Firestore.");
    }
  } catch (error) {
    console.error("Error conectando con Firestore:", error);
    alert("Verifica que Firestore Database esté activado en modo de prueba en tu consola de Firebase.");
  }
}

// Escuchadores en tiempo real (Sincronización automática)
onSnapshot(collection(db, "productos"), (snapshot) => {
  productos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  renderCatalogoPOS(document.getElementById("buscador-pos").value);
  renderTablaInventario();
});

onSnapshot(query(collection(db, "ventas"), orderBy("timestamp", "desc")), (snapshot) => {
  ventas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  renderReportes();
});

onSnapshot(collection(db, "fiados"), (snapshot) => {
  fiados = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  renderFiados();
  renderReportes();
});

// =========================================================
// 2. NAVEGACIÓN ENTRE MÓDULOS Y CONTROL DE ROLES
// =========================================================
function cambiarVista(nombreVista) {
  if (nombreVista === "reportes" && rolActual !== "admin") {
    alert("Acceso denegado: Solo el Administrador General puede ver el Cierre de Caja.");
    return;
  }

  document.querySelectorAll(".vista-modulo").forEach(sec => sec.classList.add("hidden"));
  const vistaObjetivo = document.getElementById(`vista-${nombreVista}`);
  if (vistaObjetivo) vistaObjetivo.classList.remove("hidden");

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.remove("bg-amber-500", "text-slate-900", "font-bold");
    btn.classList.add("text-slate-300", "font-semibold");
  });

  const btnActivo = document.getElementById(`tab-${nombreVista}`);
  if (btnActivo) {
    btnActivo.classList.remove("text-slate-300", "font-semibold");
    btnActivo.classList.add("bg-amber-500", "text-slate-900", "font-bold");
  }

  if (nombreVista === "pos") renderCatalogoPOS(document.getElementById("buscador-pos").value);
  if (nombreVista === "inventario") renderTablaInventario();
  if (nombreVista === "fiados") renderFiados();
  if (nombreVista === "reportes") renderReportes();
}

document.getElementById("select-rol").addEventListener("change", (e) => {
  rolActual = e.target.value;
  const tabReportes = document.getElementById("tab-reportes");
  const btnNuevoProd = document.getElementById("btn-abrir-form-producto");

  if (rolActual === "vendedor") {
    tabReportes.classList.add("hidden");
    btnNuevoProd.classList.add("hidden");
    cambiarVista("pos");
  } else {
    tabReportes.classList.remove("hidden");
    btnNuevoProd.classList.remove("hidden");
  }
  renderTablaInventario();
});

// =========================================================
// 3. MÓDULO 1: CAJA RÁPIDA (CATÁLOGO Y CARRITO)
// =========================================================
function renderCatalogoPOS(filtro = "") {
  const grid = document.getElementById("grid-productos-pos");
  grid.innerHTML = "";

  const filtrados = productos.filter(p =>
    p.nombre.toLowerCase().includes(filtro.toLowerCase()) ||
    p.codigo.toLowerCase().includes(filtro.toLowerCase())
  );

  if (filtrados.length === 0) {
    grid.innerHTML = `<p class="text-sm text-slate-400 col-span-full py-6 text-center">Cargando catálogo desde la nube...</p>`;
    return;
  }

  filtrados.forEach(prod => {
    const sinStock = prod.stock <= 0;
    const card = document.createElement("button");
    card.type = "button";
    card.disabled = sinStock;
    card.className = `text-left p-3 rounded-lg border transition flex flex-col justify-between ${
      sinStock
        ? "bg-slate-100 border-slate-200 opacity-50 cursor-not-allowed"
        : "bg-slate-50 hover:bg-amber-50 border-slate-200 hover:border-amber-400 shadow-sm"
    }`;

    card.innerHTML = `
      <div>
        <span class="text-[11px] font-mono font-bold text-slate-400">${prod.codigo}</span>
        <h3 class="font-bold text-sm text-slate-800 leading-snug mt-0.5">${prod.nombre}</h3>
      </div>
      <div class="flex justify-between items-center mt-3 pt-2 border-t border-slate-200">
        <span class="font-black text-emerald-700 text-base">Q ${Number(prod.precio).toFixed(2)}</span>
        <span class="text-xs px-2 py-0.5 rounded font-semibold ${
          prod.stock <= prod.minimo ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-700"
        }">Stock: ${prod.stock}</span>
      </div>
    `;

    card.onclick = () => agregarAlCarrito(prod.id);
    grid.appendChild(card);
  });
}

document.getElementById("buscador-pos").addEventListener("input", (e) => {
  renderCatalogoPOS(e.target.value);
});

function agregarAlCarrito(idProducto) {
  const prod = productos.find(p => p.id === idProducto);
  if (!prod || prod.stock <= 0) return;

  const itemEnCarrito = carrito.find(item => item.id === idProducto);
  if (itemEnCarrito) {
    if (itemEnCarrito.cantidad < prod.stock) {
      itemEnCarrito.cantidad++;
    } else {
      alert(`Solo hay ${prod.stock} unidades disponibles en inventario.`);
    }
  } else {
    carrito.push({
      id: prod.id,
      nombre: prod.nombre,
      costo: Number(prod.costo),
      precio: Number(prod.precio),
      cantidad: 1
    });
  }
  renderCarrito();
}

function quitarDelCarrito(idProducto) {
  carrito = carrito.filter(item => item.id !== idProducto);
  renderCarrito();
}

function renderCarrito() {
  const contenedor = document.getElementById("lista-carrito");
  if (carrito.length === 0) {
    contenedor.innerHTML = `<p class="text-sm text-slate-400 text-center py-8">El carrito está vacío. Selecciona productos.</p>`;
    document.getElementById("total-carrito").textContent = "Q 0.00";
    calcularVuelto();
    return;
  }

  contenedor.innerHTML = "";
  let total = 0;

  carrito.forEach(item => {
    const subtotal = item.precio * item.cantidad;
    total += subtotal;

    const fila = document.createElement("div");
    fila.className = "flex justify-between items-center bg-slate-50 p-2.5 rounded border border-slate-200 text-sm";
    fila.innerHTML = `
      <div class="pr-2">
        <p class="font-bold text-slate-800 leading-tight">${item.nombre}</p>
        <p class="text-xs text-slate-500">${item.cantidad} x Q ${item.precio.toFixed(2)}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-bold text-slate-800">Q ${subtotal.toFixed(2)}</span>
        <button type="button" onclick="quitarDelCarrito('${item.id}')" class="text-red-600 hover:bg-red-100 px-2 py-0.5 rounded font-bold">X</button>
      </div>
    `;
    contenedor.appendChild(fila);
  });

  document.getElementById("total-carrito").textContent = `Q ${total.toFixed(2)}`;
  calcularVuelto();
}

// =========================================================
// 4. LÓGICA DE COBRO, VUELTO Y GENERACIÓN DE TICKET EN NUBE
// =========================================================
const selectMetodoPago = document.getElementById("metodo-pago");
const inputEfectivo = document.getElementById("input-efectivo");

selectMetodoPago.addEventListener("change", () => {
  const metodo = selectMetodoPago.value;
  document.getElementById("box-efectivo").classList.toggle("hidden", metodo !== "Efectivo");
  document.getElementById("box-cliente-fiado").classList.toggle("hidden", metodo !== "Credito");
});

function calcularVuelto() {
  const total = carrito.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
  const recibido = parseFloat(inputEfectivo.value) || 0;
  const vuelto = recibido - total;
  const spanVuelto = document.getElementById("texto-vuelto");

  if (recibido > 0 && vuelto >= 0) {
    spanVuelto.textContent = `Q ${vuelto.toFixed(2)}`;
    spanVuelto.className = "text-emerald-700 font-black";
  } else if (recibido > 0 && vuelto < 0) {
    spanVuelto.textContent = `Faltan Q ${Math.abs(vuelto).toFixed(2)}`;
    spanVuelto.className = "text-red-600 font-black";
  } else {
    spanVuelto.textContent = "Q 0.00";
    spanVuelto.className = "text-blue-700";
  }
}

inputEfectivo.addEventListener("input", calcularVuelto);

document.getElementById("btn-cobrar").addEventListener("click", async () => {
  if (carrito.length === 0) {
    alert("Agrega al menos un producto al carrito antes de cobrar.");
    return;
  }

  const totalVenta = carrito.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
  const totalCosto = carrito.reduce((sum, item) => sum + item.costo * item.cantidad, 0);
  const metodo = selectMetodoPago.value;
  const nombreCliente = document.getElementById("input-cliente-fiado").value.trim();

  if (metodo === "Efectivo") {
    const recibido = parseFloat(inputEfectivo.value) || 0;
    if (recibido < totalVenta) {
      alert("El efectivo recibido es menor al total a cobrar.");
      return;
    }
  }

  if (metodo === "Credito" && !nombreCliente) {
    alert("Por favor escribe el nombre del cliente para anotar el fiado.");
    return;
  }

  const btnCobrar = document.getElementById("btn-cobrar");
  btnCobrar.disabled = true;
  btnCobrar.textContent = "GUARDANDO EN LA NUBE...";

  try {
    // 1. Descontar inventario en Firestore
    for (const item of carrito) {
      const prodActual = productos.find(p => p.id === item.id);
      if (prodActual) {
        const nuevoStock = Math.max(0, prodActual.stock - item.cantidad);
        await updateDoc(doc(db, "productos", item.id), { stock: nuevoStock });
      }
    }

    // 2. Registrar la venta en Firestore
    const nuevaVenta = {
      timestamp: Date.now(),
      fecha: new Date().toLocaleString("es-GT"),
      items: [...carrito],
      total: totalVenta,
      costoTotal: totalCosto,
      ganancia: totalVenta - totalCosto,
      metodo: metodo,
      cliente: metodo === "Credito" ? nombreCliente : "Consumidor Final"
    };
    await addDoc(collection(db, "ventas"), nuevaVenta);

    // 3. Si es crédito/fiado, actualizar o crear cuenta en Firestore
    if (metodo === "Credito") {
      const clienteExistente = fiados.find(f => f.cliente.toLowerCase() === nombreCliente.toLowerCase());
      if (clienteExistente) {
        await updateDoc(doc(db, "fiados", clienteExistente.id), {
          saldo: Number(clienteExistente.saldo) + totalVenta,
          ultimaFecha: nuevaVenta.fecha
        });
      } else {
        await addDoc(collection(db, "fiados"), {
          cliente: nombreCliente,
          saldo: totalVenta,
          ultimaFecha: nuevaVenta.fecha
        });
      }
    }

    mostrarModalTicket(nuevaVenta);

    carrito = [];
    inputEfectivo.value = "";
    document.getElementById("input-cliente-fiado").value = "";
    renderCarrito();
  } catch (error) {
    console.error("Error al procesar venta:", error);
    alert("Ocurrió un error al guardar en Firestore. Revisa tu conexión.");
  } finally {
    btnCobrar.disabled = false;
    btnCobrar.textContent = "COBRAR Y GENERAR TICKET";
  }
});

function mostrarModalTicket(venta) {
  document.getElementById("ticket-fecha").textContent = `${venta.fecha} | Pago: ${venta.metodo}`;
  const detalle = document.getElementById("ticket-detalle");
  detalle.innerHTML = venta.items.map(i => `
    <div class="flex justify-between">
      <span>${i.cantidad}x ${i.nombre}</span>
      <span>Q ${(i.precio * i.cantidad).toFixed(2)}</span>
    </div>
  `).join("");
  document.getElementById("ticket-total").textContent = `Q ${venta.total.toFixed(2)}`;
  document.getElementById("modal-ticket").classList.remove("hidden");
}

function cerrarModalTicket() {
  document.getElementById("modal-ticket").classList.add("hidden");
}

// =========================================================
// 5. MÓDULO 2: CONTROL DE INVENTARIO EN FIRESTORE
// =========================================================
document.getElementById("btn-abrir-form-producto").addEventListener("click", () => {
  document.getElementById("form-producto").classList.toggle("hidden");
});

document.getElementById("form-producto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nuevoProd = {
    codigo: document.getElementById("prod-codigo").value.trim().toUpperCase(),
    nombre: document.getElementById("prod-nombre").value.trim(),
    costo: parseFloat(document.getElementById("prod-costo").value),
    precio: parseFloat(document.getElementById("prod-precio").value),
    stock: parseInt(document.getElementById("prod-stock").value),
    minimo: 5
  };

  await addDoc(collection(db, "productos"), nuevoProd);
  e.target.reset();
  e.target.classList.add("hidden");
});

function renderTablaInventario() {
  const tbody = document.getElementById("tabla-inventario");
  const thCosto = document.querySelector(".col-costo");
  thCosto.classList.toggle("hidden", rolActual !== "admin");

  tbody.innerHTML = productos.map(p => {
    const bajo = p.stock <= p.minimo;
    return `
      <tr class="hover:bg-slate-50">
        <td class="p-3 font-mono text-xs font-bold text-slate-500">${p.codigo}</td>
        <td class="p-3 font-semibold text-slate-800">${p.nombre}</td>
        <td class="p-3 text-slate-600 ${rolActual !== "admin" ? "hidden" : ""}">Q ${Number(p.costo).toFixed(2)}</td>
        <td class="p-3 font-bold text-emerald-700">Q ${Number(p.precio).toFixed(2)}</td>
        <td class="p-3 font-bold">${p.stock} uds</td>
        <td class="p-3">
          <span class="px-2 py-1 rounded text-xs font-bold ${
            bajo ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
          }">${bajo ? "Stock Bajo" : "Óptimo"}</span>
        </td>
      </tr>
    `;
  }).join("");
}

// =========================================================
// 6. MÓDULO 3: CLIENTES Y FIADOS EN FIRESTORE
// =========================================================
function renderFiados() {
  const contenedor = document.getElementById("lista-fiados");
  const activos = fiados.filter(f => Number(f.saldo) > 0);

  if (activos.length === 0) {
    contenedor.innerHTML = `<p class="text-sm text-slate-400 col-span-full py-6 text-center">No hay clientes con saldo pendiente.</p>`;
    return;
  }

  contenedor.innerHTML = activos.map(f => `
    <div class="border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between">
      <div>
        <div class="flex justify-between items-start">
          <h3 class="font-bold text-base text-slate-800">${f.cliente}</h3>
          <span class="bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5 rounded">Pendiente</span>
        </div>
        <p class="text-xs text-slate-400 mt-1">Último movimiento: ${f.ultimaFecha}</p>
        <p class="text-2xl font-black text-red-600 mt-3">Q ${Number(f.saldo).toFixed(2)}</p>
      </div>
      <button type="button" onclick="registrarAbono('${f.id}')" class="mt-4 w-full bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold py-2 rounded-lg">
        Registrar Abono
      </button>
    </div>
  `).join("");
}

async function registrarAbono(idFiado) {
  const cuenta = fiados.find(f => f.id === idFiado);
  if (!cuenta) return;

  const montoStr = prompt(`Saldo actual de ${cuenta.cliente}: Q ${Number(cuenta.saldo).toFixed(2)}\n¿Cuánto desea abonar (Q)?`);
  const abono = parseFloat(montoStr);

  if (isNaN(abono) || abono <= 0) return;
  if (abono > Number(cuenta.saldo)) {
    alert("El abono no puede ser mayor al saldo pendiente.");
    return;
  }

  await updateDoc(doc(db, "fiados", idFiado), {
    saldo: Number(cuenta.saldo) - abono,
    ultimaFecha: new Date().toLocaleString("es-GT")
  });
}

// =========================================================
// 7. MÓDULO 4: CIERRE DE CAJA Y EXPORTAR EXCEL (CSV)
// =========================================================
function renderReportes() {
  const totalVentas = ventas.reduce((sum, v) => sum + Number(v.total), 0);
  const gananciaNeta = ventas.reduce((sum, v) => sum + Number(v.ganancia), 0);
  const totalFiados = fiados.reduce((sum, f) => sum + Number(f.saldo), 0);

  document.getElementById("rep-total-ventas").textContent = `Q ${totalVentas.toFixed(2)}`;
  document.getElementById("rep-ganancia-neta").textContent = `Q ${gananciaNeta.toFixed(2)}`;
  document.getElementById("rep-total-fiados").textContent = `Q ${totalFiados.toFixed(2)}`;

  const historial = document.getElementById("historial-ventas");
  if (ventas.length === 0) {
    historial.innerHTML = `<p class="text-slate-400 text-center py-4">Aún no se han registrado ventas hoy.</p>`;
    return;
  }

  historial.innerHTML = ventas.map(v => `
    <div class="flex flex-wrap justify-between items-center p-3 bg-slate-50 rounded border border-slate-200">
      <div>
        <span class="font-bold text-slate-800">${v.cliente}</span>
        <span class="text-xs text-slate-500 ml-2">${v.fecha}</span>
        <p class="text-xs text-slate-600">${v.items.map(i => `${i.cantidad}x ${i.nombre}`).join(", ")}</p>
      </div>
      <div class="text-right">
        <span class="font-black text-emerald-700">Q ${Number(v.total).toFixed(2)}</span>
        <span class="block text-[11px] uppercase font-bold text-slate-400">${v.metodo}</span>
      </div>
    </div>
  `).join("");
}

document.getElementById("btn-exportar-csv").addEventListener("click", () => {
  if (ventas.length === 0) {
    alert("No hay ventas registradas para exportar.");
    return;
  }

  let csv = "Fecha,Cliente,Metodo Pago,Total (Q),Ganancia (Q)\n";
  ventas.forEach(v => {
    csv += `"${v.fecha}","${v.cliente}","${v.metodo}",${Number(v.total).toFixed(2)},${Number(v.ganancia).toFixed(2)}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Cierre_MacgyFerre_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
});

// Exponer funciones al ámbito global para los botones onclick del HTML
window.cambiarVista = cambiarVista;
window.quitarDelCarrito = quitarDelCarrito;
window.cerrarModalTicket = cerrarModalTicket;
window.registrarAbono = registrarAbono;

// Arrancar conexión con Firestore
inicializarBaseDatos();