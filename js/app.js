import { db, auth } from "./firebase-config.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

// =========================================================
// CONFIGURACIÓN BASE Y FEL
// =========================================================
const CONFIG_FEL = {
  activo: false,
  endpointCloudFunction: "",
  limiteConsumidorFinal: 2500.00
};

let configNegocio = {
  nombre: "MacgyPOS",
  subtitulo: "Sistema Comercial Multi-Giro",
  nit: "CF",
  telefono: "",
  direccion: "Escuintla, Guatemala",
  prefijo: "MP",
  metaDiaria: 5000
};

const TITULO_ORIGINAL_APP = document.title;

const categoriasIniciales = ["Máquinas", "Manuales", "Materiales", "Accesorios", "General"];
const productosIniciales = [
  { codigo: "MP-001", nombre: "Saco Cemento Gris 42.5kg", categoria: "Materiales", costo: 68.00, precio: 78.00, stock: 45, minimo: 10 },
  { codigo: "MP-002", nombre: "Martillo Carpintero Mango Madera", categoria: "Manuales", costo: 32.00, precio: 45.00, stock: 8, minimo: 5 },
  { codigo: "MP-003", nombre: "Tubo PVC 1/2\" Agua Potable 6m", categoria: "Materiales", costo: 18.50, precio: 25.00, stock: 3, minimo: 10 },
  { codigo: "MP-004", nombre: "Taladro Percutor 1/2\" 650W", categoria: "Máquinas", costo: 240.00, precio: 325.00, stock: 5, minimo: 2 }
];

let categorias = [];
let categoriaFiltroPOS = "TODAS";
let productos = [];
let ventas = [];
let cotizaciones = [];
let fiados = [];
let gastos = [];
let bitacora = [];
let clientesDirectorio = [];
let carrito = [];
let rolActual = "vendedor";
let usuarioCorreoActual = "";
let listenersIniciados = false;
let documentoActualModal = null;
let ultimaAuditoriaCalculada = [];

let chartProductividad = null;
let chartCategorias = null;
let chartTopVendidos = null;
let chartTopRentables = null;

// =========================================================
// UTILIDADES GENERALES Y VALIDACIÓN SAT (MÓDULO 11)
// =========================================================
function normalizarTexto(txt) {
  return (txt || "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function validarNitSatGuatemala(valorRaw) {
  const limpio = (valorRaw || "").trim().toUpperCase().replace(/[\s-]/g, "");
  if (!limpio || limpio === "CF" || limpio === "C/F") {
    return { valido: true, tipo: "CF", limpio: "CF", mensaje: "" };
  }

  // CUI / DPI Guatemala (13 dígitos numéricos)
  if (/^\d{13}$/.test(limpio)) {
    return { valido: true, tipo: "CUI", limpio, mensaje: "CUI válido (13 dígitos)" };
  }

  // NIT Guatemala: dígitos + carácter verificador (0-9 o K)
  if (!/^\d{2,11}[0-9K]$/.test(limpio)) {
    return { valido: false, tipo: "INVALIDO", limpio, mensaje: "Formato de NIT o CUI inválido" };
  }

  const cuerpo = limpio.slice(0, -1);
  const verificador = limpio.slice(-1);

  let suma = 0;
  const longitud = cuerpo.length;
  for (let i = 0; i < longitud; i++) {
    const digito = parseInt(cuerpo[i], 10);
    const factor = longitud + 1 - i;
    suma += digito * factor;
  }

  const residuo = suma % 11;
  const resultado = (11 - residuo) % 11;
  const digitoEsperado = resultado === 10 ? "K" : String(resultado);

  if (verificador === digitoEsperado) {
    return { valido: true, tipo: "NIT", limpio, mensaje: "NIT válido (Dígito SAT verificado)" };
  }
  return { valido: false, tipo: "INVALIDO", limpio, mensaje: "NIT inválido según dígito verificador SAT" };
}

async function guardarClienteEnDirectorio(nitLimpio, nombre, telefono) {
  if (!nitLimpio || nitLimpio === "CF" || !nombre) return;
  try {
    await setDoc(doc(db, "clientes", nitLimpio), {
      nit: nitLimpio,
      nombre: nombre.trim(),
      telefono: (telefono || "").trim(),
      actualizado: Date.now()
    }, { merge: true });
  } catch (err) {
    console.error("Error guardando cliente en directorio:", err);
  }
}

async function registrarBitacora(accion, detalle) {
  try {
    await addDoc(collection(db, "bitacora"), {
      timestamp: Date.now(),
      fecha: new Date().toLocaleString("es-GT"),
      usuario: usuarioCorreoActual || rolActual,
      accion,
      detalle
    });
  } catch (e) {
    console.error("Error bitácora:", e);
  }
}

// =========================================================
// NAVEGACIÓN ENTRE PESTAÑAS
// =========================================================
function cambiarVista(nombreVista) {
  const soloAdmin = ["mando", "reportes", "analitica", "config"];
  if (soloAdmin.includes(nombreVista) && rolActual !== "admin") {
    alert("Acceso restringido al Administrador General.");
    return;
  }

  document.querySelectorAll(".vista-modulo").forEach(sec => sec.classList.add("hidden"));
  const vista = document.getElementById(`vista-${nombreVista}`);
  if (vista) vista.classList.remove("hidden");

  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.remove("bg-blue-600", "text-white", "font-bold");
    btn.classList.add("text-purple-100", "font-semibold");
  });

  const btnActivo = document.getElementById(`tab-${nombreVista}`);
  if (btnActivo) {
    btnActivo.classList.remove("text-purple-100", "font-semibold");
    btnActivo.classList.add("bg-blue-600", "text-white", "font-bold");
  }

  if (nombreVista === "mando") renderCentroMando();
  if (nombreVista === "pos") {
    renderFiltrosCategoriasPOS();
    renderCatalogoPOS();
  }
  if (nombreVista === "inventario") {
    renderCategoriasUI();
    renderTablaInventario();
  }
  if (nombreVista === "auditoria") renderTablaAuditoriaCiega();
  if (nombreVista === "fiados") renderFiados();
  if (nombreVista === "reportes") renderReportes();
  if (nombreVista === "analitica") renderAnalitica();
  if (nombreVista === "config") cargarFormularioConfig();
}

["mando", "pos", "inventario", "auditoria", "fiados", "reportes", "analitica", "config"].forEach(tab => {
  const el = document.getElementById(`tab-${tab}`);
  if (el) el.addEventListener("click", () => cambiarVista(tab));
});

document.getElementById("btn-ir-caja-rapida").addEventListener("click", () => cambiarVista("pos"));

// =========================================================
// FIRESTORE INICIALIZACIÓN Y TIEMPO REAL
// =========================================================
async function inicializarBaseDatos() {
  try {
    const cfgSnap = await getDoc(doc(db, "configuracion", "negocio"));
    if (!cfgSnap.exists()) {
      await setDoc(doc(db, "configuracion", "negocio"), configNegocio);
    }

    const snapCat = await getDocs(collection(db, "categorias"));
    if (snapCat.empty) {
      for (const nombreCat of categoriasIniciales) {
        await addDoc(collection(db, "categorias"), { nombre: nombreCat });
      }
    }

    const snapProd = await getDocs(collection(db, "productos"));
    if (snapProd.empty) {
      for (const prod of productosIniciales) {
        await addDoc(collection(db, "productos"), prod);
      }
    }
  } catch (error) {
    console.error("Error inicializando BD:", error);
  }
}

function aplicarIdentidadVisualNegocio() {
  document.getElementById("header-nombre-negocio").textContent = configNegocio.nombre;
  document.getElementById("header-subtitulo-negocio").textContent = configNegocio.subtitulo;
}

function iniciarEscuchadoresTiempoReal() {
  if (listenersIniciados) return;
  listenersIniciados = true;

  onSnapshot(doc(db, "configuracion", "negocio"), (snap) => {
    if (snap.exists()) {
      configNegocio = { ...configNegocio, ...snap.data() };
      aplicarIdentidadVisualNegocio();
      renderCentroMando();
    }
  });

  onSnapshot(collection(db, "categorias"), (snapshot) => {
    categorias = snapshot.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.nombre.localeCompare(b.nombre));
    renderCategoriasUI();
    renderFiltrosCategoriasPOS();
  });

  onSnapshot(collection(db, "productos"), (snapshot) => {
    productos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCatalogoPOS();
    renderTablaInventario();
    renderCentroMando();
  });

  onSnapshot(collection(db, "clientes"), (snapshot) => {
    clientesDirectorio = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  });

  onSnapshot(query(collection(db, "ventas"), orderBy("timestamp", "desc")), (snapshot) => {
    ventas = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReportes();
    renderCentroMando();
    if (!document.getElementById("vista-analitica").classList.contains("hidden")) renderAnalitica();
  });

  onSnapshot(query(collection(db, "cotizaciones"), orderBy("timestamp", "desc")), (snapshot) => {
    cotizaciones = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderCentroMando();
  });

  onSnapshot(collection(db, "fiados"), (snapshot) => {
    fiados = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderFiados();
    renderReportes();
    renderCentroMando();
  });

  onSnapshot(query(collection(db, "gastos"), orderBy("timestamp", "desc")), (snapshot) => {
    gastos = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReportes();
    renderCentroMando();
  });

  onSnapshot(query(collection(db, "bitacora"), orderBy("timestamp", "desc")), (snapshot) => {
    bitacora = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReportes();
    renderCentroMando();
  });
}

// =========================================================
// LOGIN Y CONTROL DE ROLES
// =========================================================
function aplicarPermisosPorRol(rol, nombrePuesto) {
  rolActual = rol;
  document.getElementById("badge-puesto").textContent = nombrePuesto;

  const tabsAdmin = ["mando", "reportes", "analitica", "config"];
  const elemsAdmin = ["btn-abrir-form-producto", "btn-abrir-form-categoria", "lbl-importar-csv"];

  if (rol === "vendedor") {
    tabsAdmin.forEach(t => document.getElementById(`tab-${t}`).classList.add("hidden"));
    elemsAdmin.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    cambiarVista("pos");
  } else {
    tabsAdmin.forEach(t => document.getElementById(`tab-${t}`).classList.remove("hidden"));
    elemsAdmin.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("hidden");
    });
    cambiarVista("mando");
  }
  renderTablaInventario();
}

document.getElementById("form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  const btn = document.getElementById("btn-login");

  errorEl.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "VERIFICANDO...";

  try {
    await signInWithEmailAndPassword(auth, email, pass);
    e.target.reset();
  } catch (err) {
    errorEl.textContent = "Correo o contraseña incorrectos.";
    errorEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "INGRESAR AL SISTEMA";
  }
});

document.getElementById("btn-cerrar-sesion").addEventListener("click", () => {
  carrito = [];
  renderCarrito();
  signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  const pantallaLogin = document.getElementById("pantalla-login");
  if (!user) {
    pantallaLogin.classList.remove("hidden");
    return;
  }

  usuarioCorreoActual = user.email || "";
  try {
    const perfilSnap = await getDoc(doc(db, "usuarios", user.uid));
    if (perfilSnap.exists()) {
      const datos = perfilSnap.data();
      const rolLimpio = (datos.rol || "vendedor").trim().toLowerCase();
      aplicarPermisosPorRol(rolLimpio, datos.nombre || rolLimpio.toUpperCase());
    } else {
      aplicarPermisosPorRol("vendedor", "Vendedor");
    }
  } catch (error) {
    aplicarPermisosPorRol("vendedor", "Vendedor");
  }

  pantallaLogin.classList.add("hidden");
  await inicializarBaseDatos();
  iniciarEscuchadoresTiempoReal();
});

// =========================================================
// MÓDULO 0: CENTRO DE MANDO EJECUTIVO (GANCHO DUEÑO)
// =========================================================
function calcularEfectivoEnGavetaHoy() {
  const hoyStr = new Date().toLocaleDateString("es-GT");
  const ventasEfectivoHoy = ventas
    .filter(v => v.metodo === "Efectivo" && (v.fechaCorta === hoyStr || (v.fecha && v.fecha.includes(hoyStr))))
    .reduce((s, v) => s + Number(v.total || 0), 0);

  const gastosHoy = gastos
    .filter(g => g.fechaCorta === hoyStr || (g.fecha && g.fecha.includes(hoyStr)))
    .reduce((s, g) => s + Number(g.monto || 0), 0);

  return ventasEfectivoHoy - gastosHoy;
}

function renderCentroMando() {
  const hoyStr = new Date().toLocaleDateString("es-GT");
  const ventasHoy = ventas.filter(v => v.fechaCorta === hoyStr || (v.fecha && v.fecha.includes(hoyStr)));

  const totalVentasHoy = ventasHoy.reduce((s, v) => s + Number(v.total || 0), 0);
  const gananciaHoy = ventasHoy.reduce((s, v) => s + Number(v.ganancia || 0), 0);
  const margenHoy = totalVentasHoy > 0 ? (gananciaHoy / totalVentasHoy) * 100 : 0;
  const efectivoGaveta = calcularEfectivoEnGavetaHoy();

  const capitalCosto = productos.reduce((s, p) => s + (Number(p.costo || 0) * Number(p.stock || 0)), 0);
  const capitalVenta = productos.reduce((s, p) => s + (Number(p.precio || 0) * Number(p.stock || 0)), 0);

  const stockBajoCount = productos.filter(p => Number(p.stock) <= Number(p.minimo || 5)).length;

  document.getElementById("hero-efectivo-gaveta").textContent = `Q ${efectivoGaveta.toFixed(2)}`;
  document.getElementById("hero-ganancia-hoy").textContent = `Q ${gananciaHoy.toFixed(2)}`;
  document.getElementById("hero-margen-hoy").textContent = `Margen neto hoy: ${margenHoy.toFixed(1)}%`;
  document.getElementById("hero-capital-bodega").textContent = `Q ${capitalCosto.toFixed(2)}`;
  document.getElementById("hero-valor-venta-bodega").textContent = `Valor venta bodega: Q ${capitalVenta.toFixed(2)}`;
  document.getElementById("hero-focos-rojos").textContent = stockBajoCount;
  document.getElementById("hero-detalle-rojos").textContent = `${stockBajoCount} productos en stock crítico`;

  const meta = Number(configNegocio.metaDiaria) || 5000;
  const pct = Math.min(100, (totalVentasHoy / meta) * 100);
  document.getElementById("texto-meta-diaria").textContent = `Ventas hoy: Q ${totalVentasHoy.toFixed(2)} de Q ${meta.toFixed(2)}`;
  document.getElementById("porcentaje-meta-diaria").textContent = `${pct.toFixed(0)}%`;
  document.getElementById("barra-meta-diaria").style.width = `${pct}%`;

  const feedEl = document.getElementById("feed-actividad-vivo");
  const eventos = [
    ...ventas.slice(0, 6).map(v => ({
      ts: v.timestamp || 0,
      color: "bg-blue-600",
      texto: `${v.fecha} — Venta ${v.correlativo || ""} por Q ${Number(v.total).toFixed(2)} (${v.cliente})`
    })),
    ...gastos.slice(0, 4).map(g => ({
      ts: g.timestamp || 0,
      color: "bg-red-600",
      texto: `${g.fecha} — Egreso caja: -Q ${Number(g.monto).toFixed(2)} (${g.motivo})`
    })),
    ...bitacora.slice(0, 4).map(b => ({
      ts: b.timestamp || 0,
      color: "bg-purple-700",
      texto: `${b.fecha} — [${b.accion}] ${b.detalle}`
    }))
  ].sort((a, b) => b.ts - a.ts).slice(0, 8);

  feedEl.innerHTML = eventos.length === 0
    ? `<p class="text-slate-400">Sin actividad registrada aún.</p>`
    : eventos.map(ev => `
      <div class="flex items-start gap-2.5 p-2 rounded bg-slate-50 border border-slate-100">
        <span class="w-2.5 h-2.5 rounded-full ${ev.color} mt-1 shrink-0"></span>
        <span class="text-slate-700">${ev.texto}</span>
      </div>
    `).join("");

  const cotEl = document.getElementById("lista-cotizaciones-mando");
  const pendientes = cotizaciones.filter(c => c.estado !== "Convertida");
  cotEl.innerHTML = pendientes.length === 0
    ? `<p class="text-slate-400">No hay cotizaciones pendientes.</p>`
    : pendientes.map(c => `
      <div class="flex justify-between items-center p-2.5 rounded bg-purple-50 border border-purple-200">
        <div>
          <span class="font-mono font-black text-purple-800">${c.correlativo}</span>
          <span class="font-bold text-slate-800 ml-1">${c.cliente}</span>
          <p class="text-[11px] text-slate-500">${c.fecha} • Q ${Number(c.total).toFixed(2)}</p>
        </div>
        <button type="button" data-cot-id="${c.id}" class="btn-convertir-cot bg-blue-600 hover:bg-blue-700 text-white font-bold px-2.5 py-1.5 rounded text-[11px]">
          Pasar a Caja
        </button>
      </div>
    `).join("");

  document.querySelectorAll(".btn-convertir-cot").forEach(btn => {
    btn.addEventListener("click", () => cargarCotizacionEnCaja(btn.getAttribute("data-cot-id")));
  });
}

document.getElementById("btn-resumen-whatsapp-admin").addEventListener("click", () => {
  const hoyStr = new Date().toLocaleDateString("es-GT");
  const ventasHoy = ventas.filter(v => v.fechaCorta === hoyStr || (v.fecha && v.fecha.includes(hoyStr)));
  const totalV = ventasHoy.reduce((s, v) => s + Number(v.total || 0), 0);
  const ganV = ventasHoy.reduce((s, v) => s + Number(v.ganancia || 0), 0);
  const gaveta = calcularEfectivoEnGavetaHoy();
  const bajos = productos.filter(p => Number(p.stock) <= Number(p.minimo || 5)).length;

  const msg = `*RESUMEN EJECUTIVO - ${configNegocio.nombre.toUpperCase()}*\n` +
    `Fecha: ${hoyStr}\n` +
    `Ventas del día: Q ${totalV.toFixed(2)}\n` +
    `Ganancia neta: Q ${ganV.toFixed(2)}\n` +
    `Efectivo en gaveta: Q ${gaveta.toFixed(2)}\n` +
    `Productos en stock bajo: ${bajos}`;

  const tel = (configNegocio.telefono || "").replace(/\D/g, "");
  const numeroFinal = tel.length === 8 ? `502${tel}` : tel;
  const url = numeroFinal ? `https://wa.me/${numeroFinal}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, "_blank");
});

function cargarCotizacionEnCaja(idCot) {
  const cot = cotizaciones.find(c => c.id === idCot);
  if (!cot) return;

  carrito = (cot.items || []).map(i => ({ ...i }));
  document.getElementById("input-nit").value = cot.nit === "CF" ? "" : cot.nit;
  document.getElementById("input-nombre-factura").value = cot.cliente === "Consumidor Final" ? "" : cot.cliente;
  document.getElementById("input-telefono-cliente").value = cot.telefono || "";

  updateDoc(doc(db, "cotizaciones", idCot), { estado: "Convertida" });
  cambiarVista("pos");
  renderCarrito();
}

// =========================================================
// MÓDULO 1: CAJA RÁPIDA, ESCÁNER, SAT Y COTIZACIONES
// =========================================================
function renderFiltrosCategoriasPOS() {
  const contenedor = document.getElementById("filtros-categoria-pos");
  if (!contenedor) return;

  const opciones = ["TODAS", ...categorias.map(c => c.nombre)];
  contenedor.innerHTML = "";

  opciones.forEach(cat => {
    const activa = categoriaFiltroPOS === cat;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = cat === "TODAS" ? "Todas" : cat;
    btn.className = activa
      ? "bg-purple-700 text-white text-xs font-bold px-3 py-1 rounded-full transition"
      : "bg-slate-100 hover:bg-purple-100 text-slate-700 text-xs font-semibold px-3 py-1 rounded-full transition";

    btn.addEventListener("click", () => {
      categoriaFiltroPOS = cat;
      renderFiltrosCategoriasPOS();
      renderCatalogoPOS();
    });
    contenedor.appendChild(btn);
  });
}

function renderCatalogoPOS() {
  const grid = document.getElementById("grid-productos-pos");
  const filtroRaw = document.getElementById("buscador-pos").value.trim();
  const palabras = normalizarTexto(filtroRaw).split(/\s+/).filter(Boolean);
  const soloDisp = document.getElementById("check-solo-disponibles").checked;

  grid.innerHTML = "";

  const filtrados = productos.filter(p => {
    if (soloDisp && Number(p.stock) <= 0) return false;
    const catProd = p.categoria || "General";
    if (categoriaFiltroPOS !== "TODAS" && catProd !== categoriaFiltroPOS) return false;

    if (palabras.length === 0) return true;
    const textoBuscable = normalizarTexto(`${p.codigo} ${p.nombre} ${catProd}`);
    return palabras.every(pal => textoBuscable.includes(pal));
  });

  if (filtrados.length === 0) {
    grid.innerHTML = `<p class="text-sm text-slate-400 col-span-full py-6 text-center">No se encontraron productos.</p>`;
    return;
  }

  filtrados.forEach(prod => {
    const sinStock = Number(prod.stock) <= 0;
    const card = document.createElement("button");
    card.type = "button";
    card.disabled = sinStock;
    card.className = `text-left p-3 rounded-lg border transition flex flex-col justify-between ${
      sinStock
        ? "bg-slate-100 border-slate-200 opacity-50 cursor-not-allowed"
        : "bg-slate-50 hover:bg-purple-50 border-slate-200 hover:border-purple-500 shadow-sm"
    }`;

    card.innerHTML = `
      <div>
        <div class="flex justify-between items-center gap-1">
          <span class="text-[11px] font-mono font-bold text-slate-400">${prod.codigo}</span>
          <span class="text-[10px] font-bold bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">${prod.categoria || "General"}</span>
        </div>
        <h3 class="font-bold text-sm text-slate-800 leading-snug mt-1">${prod.nombre}</h3>
      </div>
      <div class="flex justify-between items-center mt-3 pt-2 border-t border-slate-200">
        <span class="font-black text-blue-700 text-base">Q ${Number(prod.precio).toFixed(2)}</span>
        <span class="text-xs px-2 py-0.5 rounded font-semibold ${
          Number(prod.stock) <= Number(prod.minimo || 5) ? "bg-red-100 text-red-700" : "bg-slate-200 text-slate-700"
        }">Stock: ${prod.stock}</span>
      </div>
    `;

    card.addEventListener("click", () => agregarAlCarrito(prod.id));
    grid.appendChild(card);
  });
}

const buscadorPosEl = document.getElementById("buscador-pos");
buscadorPosEl.addEventListener("input", renderCatalogoPOS);
buscadorPosEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const codigoEscaneado = buscadorPosEl.value.trim().toUpperCase();
    if (!codigoEscaneado) return;
    const exacto = productos.find(p => p.codigo.toUpperCase() === codigoEscaneado);
    if (exacto) {
      agregarAlCarrito(exacto.id);
      buscadorPosEl.value = "";
      renderCatalogoPOS();
    }
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "F2") {
    e.preventDefault();
    cambiarVista("pos");
    buscadorPosEl.focus();
  }
});

document.getElementById("btn-limpiar-busqueda").addEventListener("click", () => {
  buscadorPosEl.value = "";
  renderCatalogoPOS();
  buscadorPosEl.focus();
});

document.getElementById("check-solo-disponibles").addEventListener("change", renderCatalogoPOS);
document.getElementById("btn-vaciar-carrito").addEventListener("click", () => {
  carrito = [];
  renderCarrito();
});

function agregarAlCarrito(idProducto) {
  const prod = productos.find(p => p.id === idProducto);
  if (!prod || Number(prod.stock) <= 0) return;

  const itemEnCarrito = carrito.find(item => item.id === idProducto);
  if (itemEnCarrito) {
    if (itemEnCarrito.cantidad < Number(prod.stock)) {
      itemEnCarrito.cantidad++;
    } else {
      alert(`Stock máximo alcanzado (${prod.stock} uds).`);
    }
  } else {
    carrito.push({
      id: prod.id,
      codigo: prod.codigo,
      nombre: prod.nombre,
      categoria: prod.categoria || "General",
      costo: Number(prod.costo),
      precio: Number(prod.precio),
      cantidad: 1
    });
  }
  renderCarrito();
}

function cambiarCantidadCarrito(idProducto, delta) {
  const item = carrito.find(i => i.id === idProducto);
  const prod = productos.find(p => p.id === idProducto);
  if (!item || !prod) return;

  const nuevaCant = item.cantidad + delta;
  if (nuevaCant <= 0) {
    carrito = carrito.filter(i => i.id !== idProducto);
  } else if (nuevaCant <= Number(prod.stock)) {
    item.cantidad = nuevaCant;
  } else {
    alert(`Solo hay ${prod.stock} unidades en inventario.`);
  }
  renderCarrito();
}

function verificarAlertaSat() {
  const total = carrito.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
  const nit = document.getElementById("input-nit").value.trim().toUpperCase();
  const esCF = nit === "" || nit === "CF" || nit === "C/F";
  document.getElementById("alerta-sat-2500").classList.toggle("hidden", !(total >= CONFIG_FEL.limiteConsumidorFinal && esCF));
}

// VALIDACIÓN SAT MÓDULO 11 Y AUTOCOMPLETADO DE CLIENTE EN TIEMPO REAL
const inputNitEl = document.getElementById("input-nit");
inputNitEl.addEventListener("input", () => {
  verificarAlertaSat();
  const estadoEl = document.getElementById("estado-nit-sat");
  const res = validarNitSatGuatemala(inputNitEl.value);

  if (res.tipo === "CF") {
    if (estadoEl) estadoEl.classList.add("hidden");
    inputNitEl.classList.remove("border-red-500", "border-blue-500");
    return;
  }

  if (estadoEl) {
    estadoEl.classList.remove("hidden", "bg-red-100", "text-red-700", "bg-blue-100", "text-blue-800");
    if (res.valido) {
      estadoEl.classList.add("bg-blue-100", "text-blue-800");
      inputNitEl.classList.remove("border-red-500");
      inputNitEl.classList.add("border-blue-500");
    } else {
      estadoEl.classList.add("bg-red-100", "text-red-700");
      inputNitEl.classList.remove("border-blue-500");
      inputNitEl.classList.add("border-red-500");
    }
    estadoEl.textContent = res.mensaje;
  }

  if (res.valido) {
    const guardado = clientesDirectorio.find(c => c.nit === res.limpio);
    if (guardado) {
      const nomEl = document.getElementById("input-nombre-factura");
      const telEl = document.getElementById("input-telefono-cliente");
      if (nomEl) nomEl.value = guardado.nombre || "";
      if (telEl && guardado.telefono) telEl.value = guardado.telefono;
      if (estadoEl) estadoEl.textContent = `${res.mensaje} • Cliente guardado cargado`;
    }
  }
});

document.getElementById("btn-set-cf").addEventListener("click", () => {
  inputNitEl.value = "";
  document.getElementById("input-nombre-factura").value = "";
  document.getElementById("input-telefono-cliente").value = "";
  const estadoEl = document.getElementById("estado-nit-sat");
  if (estadoEl) estadoEl.classList.add("hidden");
  inputNitEl.classList.remove("border-red-500", "border-blue-500");
  verificarAlertaSat();
});

function renderCarrito() {
  const contenedor = document.getElementById("lista-carrito");
  if (carrito.length === 0) {
    contenedor.innerHTML = `<p class="text-sm text-slate-400 text-center py-8">El carrito está vacío. Selecciona productos.</p>`;
    document.getElementById("total-carrito").textContent = "Q 0.00";
    calcularVuelto();
    verificarAlertaSat();
    return;
  }

  contenedor.innerHTML = "";
  let total = 0;

  carrito.forEach(item => {
    const subtotal = item.precio * item.cantidad;
    total += subtotal;

    const fila = document.createElement("div");
    fila.className = "flex justify-between items-center bg-slate-50 p-2 rounded border border-slate-200 text-xs";
    fila.innerHTML = `
      <div class="pr-2 flex-1">
        <p class="font-bold text-slate-800 leading-tight">${item.nombre}</p>
        <p class="text-slate-500">Q ${item.precio.toFixed(2)} c/u</p>
      </div>
      <div class="flex items-center gap-1.5">
        <button type="button" class="btn-menos bg-slate-200 hover:bg-slate-300 font-black px-2 py-0.5 rounded">-</button>
        <span class="font-black w-5 text-center">${item.cantidad}</span>
        <button type="button" class="btn-mas bg-slate-200 hover:bg-slate-300 font-black px-2 py-0.5 rounded">+</button>
        <span class="font-bold text-slate-800 w-16 text-right">Q ${subtotal.toFixed(2)}</span>
      </div>
    `;
    fila.querySelector(".btn-menos").addEventListener("click", () => cambiarCantidadCarrito(item.id, -1));
    fila.querySelector(".btn-mas").addEventListener("click", () => cambiarCantidadCarrito(item.id, 1));
    contenedor.appendChild(fila);
  });

  document.getElementById("total-carrito").textContent = `Q ${total.toFixed(2)}`;
  calcularVuelto();
  verificarAlertaSat();
}

const selectMetodoPago = document.getElementById("metodo-pago");
const inputEfectivo = document.getElementById("input-efectivo");

selectMetodoPago.addEventListener("change", () => {
  const m = selectMetodoPago.value;
  document.getElementById("box-efectivo").classList.toggle("hidden", m !== "Efectivo");
  document.getElementById("box-cliente-fiado").classList.toggle("hidden", m !== "Credito");
});

function calcularVuelto() {
  const total = carrito.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
  const recibido = parseFloat(inputEfectivo.value) || 0;
  const vuelto = recibido - total;
  const spanVuelto = document.getElementById("texto-vuelto");

  if (recibido > 0 && vuelto >= 0) {
    spanVuelto.textContent = `Q ${vuelto.toFixed(2)}`;
    spanVuelto.className = "text-blue-700 font-black";
  } else if (recibido > 0 && vuelto < 0) {
    spanVuelto.textContent = `Faltan Q ${Math.abs(vuelto).toFixed(2)}`;
    spanVuelto.className = "text-red-600 font-black";
  } else {
    spanVuelto.textContent = "Q 0.00";
    spanVuelto.className = "text-blue-700";
  }
}
inputEfectivo.addEventListener("input", calcularVuelto);

// COBRAR VENTA REAL
document.getElementById("btn-cobrar").addEventListener("click", async () => {
  if (carrito.length === 0) return alert("Agrega productos al carrito.");

  const validacionSat = validarNitSatGuatemala(inputNitEl.value);
  if (!validacionSat.valido) {
    inputNitEl.focus();
    return alert("El NIT o CUI ingresado no es válido según la SAT. Revisa el dígito verificador.");
  }

  const nitCapturado = validacionSat.limpio;
  const nombreFactura = document.getElementById("input-nombre-factura").value.trim();
  const telefonoCliente = document.getElementById("input-telefono-cliente").value.trim();
  const nombreFiado = document.getElementById("input-cliente-fiado").value.trim();
  const metodo = selectMetodoPago.value;

  const totalVenta = carrito.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
  const totalCosto = carrito.reduce((sum, item) => sum + item.costo * item.cantidad, 0);

  if (totalVenta >= CONFIG_FEL.limiteConsumidorFinal && nitCapturado === "CF") {
    inputNitEl.focus();
    return alert("Normativa SAT: Compras de Q 2,500.00 o más requieren NIT o CUI.");
  }
  if (nitCapturado !== "CF" && !nombreFactura) {
    document.getElementById("input-nombre-factura").focus();
    return alert("Ingresa el nombre o razón social asociada al NIT/CUI.");
  }
  if (metodo === "Efectivo" && (parseFloat(inputEfectivo.value) || 0) < totalVenta) {
    return alert("El efectivo recibido es menor al total.");
  }
  if (metodo === "Credito" && !nombreFiado) {
    return alert("Ingresa el nombre del cliente para el fiado.");
  }

  const clienteFinal = nombreFactura || (metodo === "Credito" ? nombreFiado : "Consumidor Final");
  const btnCobrar = document.getElementById("btn-cobrar");
  btnCobrar.disabled = true;
  btnCobrar.textContent = "PROCESANDO...";

  try {
    const prefijo = configNegocio.prefijo || "MP";
    const correlativo = `${prefijo}-${String(ventas.length + 1).padStart(4, "0")}`;

    for (const item of carrito) {
      const prodActual = productos.find(p => p.id === item.id);
      if (prodActual) {
        await updateDoc(doc(db, "productos", item.id), {
          stock: Math.max(0, Number(prodActual.stock) - item.cantidad)
        });
      }
    }

    const nuevaVenta = {
      tipoDocumento: "RECIBO",
      timestamp: Date.now(),
      fecha: new Date().toLocaleString("es-GT"),
      fechaCorta: new Date().toLocaleDateString("es-GT"),
      correlativo,
      items: [...carrito],
      total: totalVenta,
      costoTotal: totalCosto,
      ganancia: totalVenta - totalCosto,
      metodo,
      cliente: clienteFinal,
      nit: nitCapturado,
      telefono: telefonoCliente
    };
    await addDoc(collection(db, "ventas"), nuevaVenta);
    await guardarClienteEnDirectorio(nitCapturado, clienteFinal, telefonoCliente);

    if (metodo === "Credito") {
      const existente = fiados.find(f => f.cliente.toLowerCase() === nombreFiado.toLowerCase());
      if (existente) {
        await updateDoc(doc(db, "fiados", existente.id), {
          saldo: Number(existente.saldo) + totalVenta,
          ultimaFecha: nuevaVenta.fecha
        });
      } else {
        await addDoc(collection(db, "fiados"), {
          cliente: nombreFiado,
          saldo: totalVenta,
          ultimaFecha: nuevaVenta.fecha
        });
      }
    }

    mostrarModalDocumento(nuevaVenta);
    carrito = [];
    inputEfectivo.value = "";
    document.getElementById("input-cliente-fiado").value = "";
    inputNitEl.value = "";
    document.getElementById("input-nombre-factura").value = "";
    document.getElementById("input-telefono-cliente").value = "";
    const estadoEl = document.getElementById("estado-nit-sat");
    if (estadoEl) estadoEl.classList.add("hidden");
    inputNitEl.classList.remove("border-red-500", "border-blue-500");
    renderCarrito();
  } catch (e) {
    alert("Error al registrar venta: " + e.message);
  } finally {
    btnCobrar.disabled = false;
    btnCobrar.textContent = "COBRAR Y GENERAR RECIBO";
  }
});

// GUARDAR COTIZACIÓN SIN DESCONTAR STOCK
document.getElementById("btn-guardar-cotizacion").addEventListener("click", async () => {
  if (carrito.length === 0) return alert("Agrega productos para cotizar.");

  const validacionSat = validarNitSatGuatemala(inputNitEl.value);
  if (!validacionSat.valido) {
    inputNitEl.focus();
    return alert("El NIT o CUI ingresado no es válido según la SAT.");
  }

  const nitCapturado = validacionSat.limpio;
  const clienteFinal = document.getElementById("input-nombre-factura").value.trim() || "Cliente Cotización";
  const telefonoCliente = document.getElementById("input-telefono-cliente").value.trim();
  const totalCot = carrito.reduce((sum, item) => sum + item.precio * item.cantidad, 0);
  const correlativo = `COT-${String(cotizaciones.length + 1).padStart(4, "0")}`;

  const nuevaCot = {
    tipoDocumento: "COTIZACIÓN",
    timestamp: Date.now(),
    fecha: new Date().toLocaleString("es-GT"),
    correlativo,
    items: [...carrito],
    total: totalCot,
    metodo: "Cotización (Vigencia 8 días)",
    cliente: clienteFinal,
    nit: nitCapturado,
    telefono: telefonoCliente,
    estado: "Pendiente"
  };

  await addDoc(collection(db, "cotizaciones"), nuevaCot);
  await guardarClienteEnDirectorio(nitCapturado, clienteFinal, telefonoCliente);
  mostrarModalDocumento(nuevaCot);
});

function mostrarModalDocumento(docData) {
  documentoActualModal = docData;
  const nitLimpio = (docData.nit || "CF").replace(/[^a-zA-Z0-9]/g, "");
  document.title = `${docData.tipoDocumento}_${docData.correlativo}_NIT-${nitLimpio}`;

  document.getElementById("ticket-empresa-nombre").textContent = configNegocio.nombre;
  document.getElementById("ticket-empresa-dir").textContent = configNegocio.direccion;
  document.getElementById("ticket-empresa-nit").textContent = `NIT: ${configNegocio.nit}`;
  document.getElementById("ticket-tipo-doc").textContent = docData.tipoDocumento;
  document.getElementById("ticket-correlativo").textContent = docData.correlativo;
  document.getElementById("ticket-fecha").textContent = `${docData.fecha} | ${docData.metodo}`;
  document.getElementById("ticket-nit").textContent = docData.nit;
  document.getElementById("ticket-cliente").textContent = docData.cliente;
  document.getElementById("ticket-fel-estado").textContent = docData.tipoDocumento === "COTIZACIÓN"
    ? "Proforma / No válida como factura"
    : "Comprobante Interno (Pre-FEL)";

  document.getElementById("ticket-detalle").innerHTML = docData.items.map(i => `
    <div class="flex justify-between">
      <span>${i.cantidad}x ${i.nombre}</span>
      <span>Q ${(i.precio * i.cantidad).toFixed(2)}</span>
    </div>
  `).join("");
  document.getElementById("ticket-total").textContent = `Q ${docData.total.toFixed(2)}`;
  document.getElementById("modal-ticket").classList.remove("hidden");
}

document.getElementById("btn-enviar-whatsapp-ticket").addEventListener("click", () => {
  if (!documentoActualModal) return;
  const d = documentoActualModal;
  const lineas = d.items.map(i => `• ${i.cantidad}x ${i.nombre} — Q ${(i.precio * i.cantidad).toFixed(2)}`).join("\n");
  const texto = `*${configNegocio.nombre.toUpperCase()}*\n` +
    `${d.tipoDocumento} No. *${d.correlativo}*\n` +
    `Fecha: ${d.fecha}\n` +
    `Cliente: ${d.cliente} (NIT: ${d.nit})\n\n` +
    `*Detalle:*\n${lineas}\n\n` +
    `*TOTAL: Q ${Number(d.total).toFixed(2)}*\n` +
    `¡Gracias por su preferencia!`;

  const telLimpio = (d.telefono || "").replace(/\D/g, "");
  const numeroFinal = telLimpio.length === 8 ? `502${telLimpio}` : telLimpio;
  const url = numeroFinal
    ? `https://wa.me/${numeroFinal}?text=${encodeURIComponent(texto)}`
    : `https://wa.me/?text=${encodeURIComponent(texto)}`;
  window.open(url, "_blank");
});

document.getElementById("btn-cerrar-ticket").addEventListener("click", () => {
  document.getElementById("modal-ticket").classList.add("hidden");
  document.title = TITULO_ORIGINAL_APP;
});

// =========================================================
// MÓDULO 2: INVENTARIO, EDICIÓN Y EXCEL REAL (.XLSX)
// =========================================================
function renderCategoriasUI() {
  const selectCat = document.getElementById("prod-categoria");
  const badgesContainer = document.getElementById("lista-categorias-badges");
  const listaNombres = categorias.length > 0 ? categorias.map(c => c.nombre) : categoriasIniciales;

  if (selectCat) {
    selectCat.innerHTML = listaNombres.map(n => `<option value="${n}">${n}</option>`).join("");
  }

  if (badgesContainer) {
    badgesContainer.innerHTML = "";
    categorias.forEach(cat => {
      const chip = document.createElement("span");
      chip.className = "inline-flex items-center gap-1.5 bg-white border border-purple-300 text-purple-900 text-xs font-bold px-2.5 py-1 rounded-full";
      chip.innerHTML = `<span>${cat.nombre}</span>`;
      if (rolActual === "admin") {
        const btnDel = document.createElement("button");
        btnDel.type = "button";
        btnDel.className = "text-red-600 font-black ml-1";
        btnDel.textContent = "×";
        btnDel.addEventListener("click", async () => {
          if (confirm(`¿Eliminar clasificación "${cat.nombre}"?`)) {
            await deleteDoc(doc(db, "categorias", cat.id));
          }
        });
        chip.appendChild(btnDel);
      }
      badgesContainer.appendChild(chip);
    });
  }
}

document.getElementById("btn-abrir-form-categoria").addEventListener("click", () => {
  document.getElementById("box-categorias").classList.toggle("hidden");
});

document.getElementById("form-categoria").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (rolActual !== "admin") return;
  const nombre = document.getElementById("cat-nombre").value.trim();
  if (!nombre) return;
  await addDoc(collection(db, "categorias"), { nombre });
  document.getElementById("cat-nombre").value = "";
});

document.getElementById("btn-abrir-form-producto").addEventListener("click", () => {
  document.getElementById("prod-edit-id").value = "";
  document.getElementById("titulo-form-producto").textContent = "Agregar Nuevo Producto";
  document.getElementById("form-producto").reset();
  renderCategoriasUI();
  document.getElementById("form-producto").classList.remove("hidden");
});

document.getElementById("btn-cancelar-edicion-prod").addEventListener("click", () => {
  document.getElementById("form-producto").classList.add("hidden");
  document.getElementById("form-producto").reset();
  document.getElementById("prod-edit-id").value = "";
});

document.getElementById("form-producto").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (rolActual !== "admin") return;

  const editId = document.getElementById("prod-edit-id").value;
  const datosProd = {
    codigo: document.getElementById("prod-codigo").value.trim().toUpperCase(),
    nombre: document.getElementById("prod-nombre").value.trim(),
    categoria: document.getElementById("prod-categoria").value || "General",
    costo: parseFloat(document.getElementById("prod-costo").value),
    precio: parseFloat(document.getElementById("prod-precio").value),
    stock: parseInt(document.getElementById("prod-stock").value),
    minimo: 5
  };

  if (datosProd.precio < datosProd.costo) {
    if (!confirm("Advertencia: El precio de venta es menor al costo de compra. ¿Deseas guardarlo así?")) return;
  }

  if (editId) {
    await updateDoc(doc(db, "productos", editId), datosProd);
    await registrarBitacora("EDICIÓN PRODUCTO", `Se editó ${datosProd.codigo} (${datosProd.nombre}) - Precio Q${datosProd.precio}, Stock ${datosProd.stock}`);
  } else {
    await addDoc(collection(db, "productos"), datosProd);
    await registrarBitacora("ALTA PRODUCTO", `Se creó ${datosProd.codigo} (${datosProd.nombre})`);
  }

  e.target.reset();
  document.getElementById("prod-edit-id").value = "";
  e.target.classList.add("hidden");
});

function abrirEdicionProducto(prod) {
  renderCategoriasUI();
  document.getElementById("prod-edit-id").value = prod.id;
  document.getElementById("titulo-form-producto").textContent = `Editando: ${prod.codigo} - ${prod.nombre}`;
  document.getElementById("prod-codigo").value = prod.codigo;
  document.getElementById("prod-nombre").value = prod.nombre;
  document.getElementById("prod-categoria").value = prod.categoria || "General";
  document.getElementById("prod-costo").value = prod.costo;
  document.getElementById("prod-precio").value = prod.precio;
  document.getElementById("prod-stock").value = prod.stock;
  document.getElementById("form-producto").classList.remove("hidden");
  document.getElementById("form-producto").scrollIntoView({ behavior: "smooth" });
}

document.getElementById("buscador-inventario").addEventListener("input", renderTablaInventario);
document.getElementById("check-solo-stock-bajo").addEventListener("change", renderTablaInventario);

function renderTablaInventario() {
  const tbody = document.getElementById("tabla-inventario");
  const thCosto = document.querySelector(".col-costo");
  const thAcciones = document.querySelector(".col-acciones-inv");
  if (thCosto) thCosto.classList.toggle("hidden", rolActual !== "admin");
  if (thAcciones) thAcciones.classList.toggle("hidden", rolActual !== "admin");

  const filtro = normalizarTexto(document.getElementById("buscador-inventario").value);
  const soloBajo = document.getElementById("check-solo-stock-bajo").checked;

  const lista = productos.filter(p => {
    const bajo = Number(p.stock) <= Number(p.minimo || 5);
    if (soloBajo && !bajo) return false;
    if (!filtro) return true;
    return normalizarTexto(`${p.codigo} ${p.nombre} ${p.categoria}`).includes(filtro);
  });

  tbody.innerHTML = "";
  lista.forEach(p => {
    const bajo = Number(p.stock) <= Number(p.minimo || 5);
    const tr = document.createElement("tr");
    tr.className = "hover:bg-purple-50/50";
    tr.innerHTML = `
      <td class="p-3 font-mono text-xs font-bold text-slate-500">${p.codigo}</td>
      <td class="p-3 font-semibold text-slate-800">${p.nombre}</td>
      <td class="p-3"><span class="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-0.5 rounded">${p.categoria || "General"}</span></td>
      <td class="p-3 text-slate-600 ${rolActual !== "admin" ? "hidden" : ""}">Q ${Number(p.costo).toFixed(2)}</td>
      <td class="p-3 font-bold text-blue-700">Q ${Number(p.precio).toFixed(2)}</td>
      <td class="p-3 font-bold">${p.stock} uds</td>
      <td class="p-3">
        <span class="px-2 py-1 rounded text-xs font-bold ${bajo ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"}">
          ${bajo ? "Pedir Stock" : "Óptimo"}
        </span>
      </td>
      <td class="p-3 text-right space-x-2 ${rolActual !== "admin" ? "hidden" : ""}">
        <button type="button" class="btn-editar-prod text-blue-600 hover:underline font-bold text-xs">Editar</button>
        <button type="button" class="btn-borrar-prod text-red-600 hover:underline font-bold text-xs">Eliminar</button>
      </td>
    `;

    if (rolActual === "admin") {
      tr.querySelector(".btn-editar-prod").addEventListener("click", () => abrirEdicionProducto(p));
      tr.querySelector(".btn-borrar-prod").addEventListener("click", async () => {
        if (confirm(`¿Seguro que deseas eliminar "${p.nombre}" del inventario?`)) {
          await deleteDoc(doc(db, "productos", p.id));
          await registrarBitacora("ELIMINACIÓN PRODUCTO", `Se eliminó ${p.codigo} (${p.nombre})`);
        }
      });
    }
    tbody.appendChild(tr);
  });
}

// EXPORTAR E IMPORTAR INVENTARIO REAL EN EXCEL (.XLSX)
document.getElementById("btn-exportar-inventario-csv").addEventListener("click", () => {
  if (typeof XLSX === "undefined") {
    return alert("No se cargó la librería de Excel. Recarga la página con internet activo.");
  }

  const filasExcel = productos.map(p => ({
    Codigo: p.codigo,
    Nombre: p.nombre,
    Clasificacion: p.categoria || "General",
    Costo: Number(p.costo || 0),
    Precio: Number(p.precio || 0),
    Stock: Number(p.stock || 0)
  }));

  const hoja = XLSX.utils.json_to_sheet(filasExcel);
  hoja["!cols"] = [{ wch: 14 }, { wch: 45 }, { wch: 24 }, { wch: 12 }, { wch: 12 }, { wch: 10 }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Inventario");
  XLSX.writeFile(libro, `Inventario_${configNegocio.nombre.replace(/\s+/g, "_")}.xlsx`);
});

document.getElementById("input-importar-csv").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || rolActual !== "admin") return;

  if (typeof XLSX === "undefined") {
    return alert("No se cargó la librería de Excel.");
  }

  try {
    const buffer = await file.arrayBuffer();
    const libro = XLSX.read(buffer, { type: "array" });
    const primeraHoja = libro.Sheets[libro.SheetNames[0]];
    const registros = XLSX.utils.sheet_to_json(primeraHoja, { defval: "" });

    let creados = 0;
    let actualizados = 0;
    const categoriasExistentes = new Set(categorias.map(c => c.nombre.toLowerCase()));

    for (const fila of registros) {
      const codigo = String(fila.Codigo || fila.CODIGO || fila.codigo || "").trim().toUpperCase();
      const nombre = String(fila.Nombre || fila.NOMBRE || fila.nombre || "").trim();
      const categoria = String(fila.Clasificacion || fila.CLASIFICACION || fila.Categoria || "General").trim() || "General";
      const costo = parseFloat(fila.Costo ?? fila.COSTO ?? fila.costo) || 0;
      const precio = parseFloat(fila.Precio ?? fila.PRECIO ?? fila.precio) || 0;
      const stock = parseInt(fila.Stock ?? fila.STOCK ?? fila.stock) || 0;

      if (!codigo || !nombre) continue;

      if (!categoriasExistentes.has(categoria.toLowerCase())) {
        await addDoc(collection(db, "categorias"), { nombre: categoria });
        categoriasExistentes.add(categoria.toLowerCase());
      }

      const existente = productos.find(p => p.codigo.toUpperCase() === codigo);
      if (existente) {
        await updateDoc(doc(db, "productos", existente.id), {
          nombre,
          categoria,
          costo,
          precio,
          stock
        });
        actualizados++;
      } else {
        await addDoc(collection(db, "productos"), {
          codigo,
          nombre,
          categoria,
          costo,
          precio,
          stock,
          minimo: 5
        });
        creados++;
      }
    }

    await registrarBitacora("IMPORTACIÓN EXCEL", `Archivo ${file.name}: ${creados} nuevos, ${actualizados} actualizados.`);
    alert(`Excel importado correctamente:\n• Productos nuevos: ${creados}\n• Productos actualizados: ${actualizados}\n• Clasificaciones sincronizadas automáticamente.`);
  } catch (err) {
    console.error("Error leyendo Excel:", err);
    alert("No se pudo leer el archivo Excel: " + err.message);
  } finally {
    e.target.value = "";
  }
});

// =========================================================
// MÓDULO 3: AUDITORÍA FÍSICA (CONTEO CIEGO)
// =========================================================
function renderTablaAuditoriaCiega() {
  const tbody = document.getElementById("tabla-auditoria-ciega");
  document.getElementById("resultado-auditoria-box").classList.add("hidden");
  tbody.innerHTML = productos.map(p => `
    <tr>
      <td class="p-3 font-mono text-xs font-bold text-slate-500">${p.codigo}</td>
      <td class="p-3 font-semibold text-slate-800">${p.nombre}</td>
      <td class="p-3 text-xs text-slate-600">${p.categoria || "General"}</td>
      <td class="p-3">
        <input type="number" min="0" data-prod-id="${p.id}" placeholder="Contar..."
          class="input-conteo-ciego w-32 border border-purple-300 rounded px-2.5 py-1.5 text-sm font-bold" />
      </td>
    </tr>
  `).join("");
}

document.getElementById("btn-procesar-auditoria").addEventListener("click", () => {
  const inputs = document.querySelectorAll(".input-conteo-ciego");
  ultimaAuditoriaCalculada = [];
  let impactoQuetzales = 0;

  inputs.forEach(inp => {
    if (inp.value === "") return;
    const prod = productos.find(p => p.id === inp.getAttribute("data-prod-id"));
    if (!prod) return;
    const contado = parseInt(inp.value) || 0;
    const teorico = Number(prod.stock);
    const diff = contado - teorico;
    const valorDiff = diff * Number(prod.costo || 0);
    impactoQuetzales += valorDiff;

    ultimaAuditoriaCalculada.push({
      id: prod.id,
      codigo: prod.codigo,
      nombre: prod.nombre,
      teorico,
      contado,
      diff,
      valorDiff
    });
  });

  if (ultimaAuditoriaCalculada.length === 0) {
    return alert("Ingresa al menos el conteo físico de un producto.");
  }

  const box = document.getElementById("resultado-auditoria-box");
  const resumenEl = document.getElementById("resumen-impacto-auditoria");
  const detalleEl = document.getElementById("detalle-diferencias-auditoria");

  resumenEl.textContent = impactoQuetzales < 0
    ? `ALERTA: Faltante valorizado al costo por Q ${Math.abs(impactoQuetzales).toFixed(2)}`
    : `Balance de auditoría al costo: Q ${impactoQuetzales.toFixed(2)}`;

  detalleEl.innerHTML = ultimaAuditoriaCalculada.map(item => `
    <div class="flex justify-between p-2 rounded ${item.diff < 0 ? "bg-red-100 text-red-900" : item.diff > 0 ? "bg-blue-100 text-blue-900" : "bg-white"}">
      <span><strong>${item.codigo}</strong> ${item.nombre} (Sistema: ${item.teorico} | Físico: ${item.contado})</span>
      <span class="font-bold">${item.diff === 0 ? "Cuadre Exacto" : `Diferencia: ${item.diff > 0 ? "+" : ""}${item.diff} uds (Q ${item.valorDiff.toFixed(2)})`}</span>
    </div>
  `).join("");

  box.classList.remove("hidden");
});

document.getElementById("btn-aplicar-ajuste-auditoria").addEventListener("click", async () => {
  if (rolActual !== "admin") return alert("Solo el Administrador puede aplicar ajustes de auditoría.");
  for (const item of ultimaAuditoriaCalculada) {
    await updateDoc(doc(db, "productos", item.id), { stock: item.contado });
  }
  await registrarBitacora("AUDITORÍA FÍSICA", `Se ajustó inventario físico de ${ultimaAuditoriaCalculada.length} productos.`);
  alert("Inventario actualizado según conteo físico y registrado en bitácora.");
  document.getElementById("resultado-auditoria-box").classList.add("hidden");
});

// =========================================================
// MÓDULO 4: FIADOS
// =========================================================
function renderFiados() {
  const contenedor = document.getElementById("lista-fiados");
  const activos = fiados.filter(f => Number(f.saldo) > 0);
  if (activos.length === 0) {
    contenedor.innerHTML = `<p class="text-sm text-slate-400 col-span-full py-6 text-center">No hay clientes con saldo pendiente.</p>`;
    return;
  }

  contenedor.innerHTML = "";
  activos.forEach(f => {
    const card = document.createElement("div");
    card.className = "border border-slate-200 rounded-xl p-4 bg-slate-50 flex flex-col justify-between";
    card.innerHTML = `
      <div>
        <div class="flex justify-between items-start">
          <h3 class="font-bold text-base text-slate-800">${f.cliente}</h3>
          <span class="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-0.5 rounded">Pendiente</span>
        </div>
        <p class="text-xs text-slate-400 mt-1">Último movimiento: ${f.ultimaFecha}</p>
        <p class="text-2xl font-black text-red-600 mt-3">Q ${Number(f.saldo).toFixed(2)}</p>
      </div>
    `;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg";
    btn.textContent = "Registrar Abono";
    btn.addEventListener("click", async () => {
      const abono = parseFloat(prompt(`Saldo de ${f.cliente}: Q ${Number(f.saldo).toFixed(2)}\nMonto a abonar (Q):`));
      if (isNaN(abono) || abono <= 0 || abono > Number(f.saldo)) return;
      await updateDoc(doc(db, "fiados", f.id), {
        saldo: Number(f.saldo) - abono,
        ultimaFecha: new Date().toLocaleString("es-GT")
      });
      await registrarBitacora("ABONO FIADO", `${f.cliente} abonó Q ${abono.toFixed(2)}`);
    });
    card.appendChild(btn);
    contenedor.appendChild(card);
  });
}

// =========================================================
// MÓDULO 5: CIERRE CIEGO, GASTOS Y BITÁCORA
// =========================================================
document.getElementById("form-gasto").addEventListener("submit", async (e) => {
  e.preventDefault();
  const motivo = document.getElementById("gasto-motivo").value.trim();
  const monto = parseFloat(document.getElementById("gasto-monto").value);
  if (!motivo || isNaN(monto) || monto <= 0) return;

  await addDoc(collection(db, "gastos"), {
    timestamp: Date.now(),
    fecha: new Date().toLocaleString("es-GT"),
    fechaCorta: new Date().toLocaleDateString("es-GT"),
    motivo,
    monto
  });
  await registrarBitacora("EGRESO CAJA", `Gasto de Q ${monto.toFixed(2)} - ${motivo}`);
  e.target.reset();
});

document.getElementById("btn-ejecutar-arqueo").addEventListener("click", async () => {
  const contado = parseFloat(document.getElementById("input-arqueo-contado").value);
  if (isNaN(contado) || contado < 0) return alert("Ingresa el efectivo físico contado.");

  const esperado = calcularEfectivoEnGavetaHoy();
  const diff = contado - esperado;
  const box = document.getElementById("resultado-arqueo-box");
  box.classList.remove("hidden", "bg-red-100", "text-red-800", "bg-blue-100", "text-blue-800");

  if (Math.abs(diff) < 0.01) {
    box.classList.add("bg-blue-100", "text-blue-800");
    box.textContent = `CUADRE EXACTO: Contado Q ${contado.toFixed(2)} = Sistema Q ${esperado.toFixed(2)}`;
  } else if (diff < 0) {
    box.classList.add("bg-red-100", "text-red-800");
    box.textContent = `FALTANTE EN CAJA: Contado Q ${contado.toFixed(2)} vs Esperado Q ${esperado.toFixed(2)} (Diferencia: -Q ${Math.abs(diff).toFixed(2)})`;
  } else {
    box.classList.add("bg-blue-100", "text-blue-800");
    box.textContent = `SOBRANTE EN CAJA: Contado Q ${contado.toFixed(2)} vs Esperado Q ${esperado.toFixed(2)} (Diferencia: +Q ${diff.toFixed(2)})`;
  }

  await registrarBitacora("ARQUEO CIEGO", box.textContent);
});

function renderReportes() {
  const totalVentas = ventas.reduce((s, v) => s + Number(v.total || 0), 0);
  const gananciaNeta = ventas.reduce((s, v) => s + Number(v.ganancia || 0), 0);
  const totalGastos = gastos.reduce((s, g) => s + Number(g.monto || 0), 0);
  const totalFiados = fiados.reduce((s, f) => s + Number(f.saldo || 0), 0);

  document.getElementById("rep-total-ventas").textContent = `Q ${totalVentas.toFixed(2)}`;
  document.getElementById("rep-ganancia-neta").textContent = `Q ${gananciaNeta.toFixed(2)}`;
  document.getElementById("rep-total-gastos").textContent = `Q ${totalGastos.toFixed(2)}`;
  document.getElementById("rep-total-fiados").textContent = `Q ${totalFiados.toFixed(2)}`;

  document.getElementById("lista-gastos").innerHTML = gastos.slice(0, 10).map(g => `
    <div class="flex justify-between p-2 bg-red-50 rounded border border-red-100">
      <span><strong>${g.motivo}</strong> <span class="text-slate-400">(${g.fecha})</span></span>
      <span class="font-bold text-red-700">-Q ${Number(g.monto).toFixed(2)}</span>
    </div>
  `).join("");

  document.getElementById("historial-ventas").innerHTML = ventas.map(v => `
    <div class="flex justify-between items-center p-2.5 bg-slate-50 rounded border border-slate-200">
      <div>
        <span class="font-mono text-xs font-black bg-purple-100 text-purple-900 px-1.5 py-0.5 rounded">${v.correlativo || "S/N"}</span>
        <span class="font-bold text-slate-800 ml-1">${v.cliente}</span>
        <span class="text-[11px] font-mono bg-slate-200 px-1.5 py-0.5 rounded ml-1">NIT: ${v.nit || "CF"}</span>
        <p class="text-xs text-slate-500 mt-0.5">${v.fecha} • ${v.metodo}</p>
      </div>
      <span class="font-black text-blue-700">Q ${Number(v.total).toFixed(2)}</span>
    </div>
  `).join("");

  document.getElementById("lista-bitacora").innerHTML = bitacora.slice(0, 25).map(b => `
    <div class="p-2 bg-slate-50 rounded border border-slate-200">
      <div class="flex justify-between font-bold text-purple-900">
        <span>${b.accion}</span>
        <span class="text-slate-400 font-normal">${b.fecha}</span>
      </div>
      <p class="text-slate-700 mt-0.5">${b.detalle} <span class="text-slate-400">(${b.usuario})</span></p>
    </div>
  `).join("");
}

document.getElementById("btn-exportar-csv").addEventListener("click", () => {
  if (typeof XLSX !== "undefined") {
    const filas = ventas.map(v => ({
      Correlativo: v.correlativo || "",
      Fecha: v.fecha,
      NIT: v.nit || "CF",
      Cliente: v.cliente,
      Metodo: v.metodo,
      Total: Number(v.total || 0),
      Ganancia: Number(v.ganancia || 0)
    }));
    const hoja = XLSX.utils.json_to_sheet(filas);
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, "Cierre_Ventas");
    XLSX.writeFile(libro, `Cierre_${configNegocio.nombre.replace(/\s+/g, "_")}.xlsx`);
    return;
  }

  let csv = "Correlativo,Fecha,NIT,Cliente,Metodo,Total,Ganancia\n";
  ventas.forEach(v => {
    csv += `"${v.correlativo || ""}","${v.fecha}","${v.nit || "CF"}","${v.cliente}","${v.metodo}",${Number(v.total).toFixed(2)},${Number(v.ganancia).toFixed(2)}\n`;
  });
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `Cierre_${configNegocio.nombre.replace(/\s+/g, "_")}.csv`;
  a.click();
});

// =========================================================
// MÓDULO 6: ANALÍTICA (PALETA LILA + AZUL + ROJO)
// =========================================================
function renderAnalitica() {
  if (typeof Chart === "undefined") return;

  let totalIngresos = 0;
  let totalGanancia = 0;
  let totalUnidades = 0;
  const mapaFechas = {};
  const mapaProductos = {};
  const mapaCategorias = {};
  const productosVendidosSet = new Set();

  ventas.forEach(v => {
    const ing = Number(v.total) || 0;
    const gan = Number(v.ganancia) || 0;
    totalIngresos += ing;
    totalGanancia += gan;

    const fechaDia = v.fechaCorta || (v.fecha ? v.fecha.split(",")[0].trim() : "Hoy");
    if (!mapaFechas[fechaDia]) mapaFechas[fechaDia] = { ventas: 0, ganancia: 0 };
    mapaFechas[fechaDia].ventas += ing;
    mapaFechas[fechaDia].ganancia += gan;

    (v.items || []).forEach(item => {
      productosVendidosSet.add(item.codigo);
      const cant = Number(item.cantidad) || 0;
      const sub = (Number(item.precio) || 0) * cant;
      const util = sub - ((Number(item.costo) || 0) * cant);
      totalUnidades += cant;

      const cat = item.categoria || "General";
      if (!mapaProductos[item.nombre]) mapaProductos[item.nombre] = { unidades: 0, ganancia: 0 };
      mapaProductos[item.nombre].unidades += cant;
      mapaProductos[item.nombre].ganancia += util;
      mapaCategorias[cat] = (mapaCategorias[cat] || 0) + sub;
    });
  });

  const capitalHueso = productos
    .filter(p => Number(p.stock) > 0 && !productosVendidosSet.has(p.codigo))
    .reduce((s, p) => s + (Number(p.costo || 0) * Number(p.stock || 0)), 0);

  const ticketProm = ventas.length > 0 ? totalIngresos / ventas.length : 0;
  const margenGlob = totalIngresos > 0 ? (totalGanancia / totalIngresos) * 100 : 0;

  document.getElementById("kpi-ticket-promedio").textContent = `Q ${ticketProm.toFixed(2)}`;
  document.getElementById("kpi-margen-global").textContent = `${margenGlob.toFixed(1)}%`;
  document.getElementById("kpi-unidades-vendidas").textContent = `${totalUnidades} uds`;
  document.getElementById("kpi-capital-hueso").textContent = `Q ${capitalHueso.toFixed(2)}`;

  const fechasOrd = Object.keys(mapaFechas).reverse();
  if (chartProductividad) chartProductividad.destroy();
  chartProductividad = new Chart(document.getElementById("chart-productividad"), {
    type: "bar",
    data: {
      labels: fechasOrd.length ? fechasOrd : ["Sin ventas"],
      datasets: [
        { label: "Ventas (Q)", data: fechasOrd.length ? fechasOrd.map(f => mapaFechas[f].ventas) : [0], backgroundColor: "#6d28d9", borderRadius: 6 },
        { label: "Ganancia Neta (Q)", data: fechasOrd.length ? fechasOrd.map(f => mapaFechas[f].ganancia) : [0], backgroundColor: "#2563eb", borderRadius: 6 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });

  const catOrd = Object.entries(mapaCategorias).sort((a, b) => b[1] - a[1]);
  if (chartCategorias) chartCategorias.destroy();
  chartCategorias = new Chart(document.getElementById("chart-categorias"), {
    type: "doughnut",
    data: {
      labels: catOrd.length ? catOrd.map(c => c[0]) : ["Sin datos"],
      datasets: [{
        data: catOrd.length ? catOrd.map(c => c[1]) : [1],
        backgroundColor: ["#7c3aed", "#2563eb", "#dc2626", "#9333ea", "#3b82f6", "#ef4444"]
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });

  const topVend = Object.entries(mapaProductos).sort((a, b) => b[1].unidades - a[1].unidades).slice(0, 5);
  if (chartTopVendidos) chartTopVendidos.destroy();
  chartTopVendidos = new Chart(document.getElementById("chart-top-vendidos"), {
    type: "bar",
    data: {
      labels: topVend.length ? topVend.map(p => p[0]) : ["Sin datos"],
      datasets: [{ label: "Unidades", data: topVend.length ? topVend.map(p => p[1].unidades) : [0], backgroundColor: "#7c3aed", borderRadius: 6 }]
    },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });

  const topRent = Object.entries(mapaProductos).sort((a, b) => b[1].ganancia - a[1].ganancia).slice(0, 5);
  if (chartTopRentables) chartTopRentables.destroy();
  chartTopRentables = new Chart(document.getElementById("chart-top-rentables"), {
    type: "bar",
    data: {
      labels: topRent.length ? topRent.map(p => p[0]) : ["Sin datos"],
      datasets: [{ label: "Ganancia (Q)", data: topRent.length ? topRent.map(p => Number(p[1].ganancia.toFixed(2))) : [0], backgroundColor: "#2563eb", borderRadius: 6 }]
    },
    options: { indexAxis: "y", responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
  });
}

// =========================================================
// MÓDULO 7: CONFIGURACIÓN MARCA BLANCA
// =========================================================
function cargarFormularioConfig() {
  document.getElementById("cfg-nombre").value = configNegocio.nombre || "";
  document.getElementById("cfg-subtitulo").value = configNegocio.subtitulo || "";
  document.getElementById("cfg-nit").value = configNegocio.nit || "CF";
  document.getElementById("cfg-telefono").value = configNegocio.telefono || "";
  document.getElementById("cfg-prefijo").value = configNegocio.prefijo || "MP";
  document.getElementById("cfg-meta-diaria").value = configNegocio.metaDiaria || 5000;
  document.getElementById("cfg-direccion").value = configNegocio.direccion || "";
}

document.getElementById("form-config-negocio").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (rolActual !== "admin") return;

  const nuevaCfg = {
    nombre: document.getElementById("cfg-nombre").value.trim(),
    subtitulo: document.getElementById("cfg-subtitulo").value.trim(),
    nit: document.getElementById("cfg-nit").value.trim().toUpperCase(),
    telefono: document.getElementById("cfg-telefono").value.trim(),
    prefijo: document.getElementById("cfg-prefijo").value.trim().toUpperCase(),
    metaDiaria: parseFloat(document.getElementById("cfg-meta-diaria").value) || 5000,
    direccion: document.getElementById("cfg-direccion").value.trim()
  };

  await setDoc(doc(db, "configuracion", "negocio"), nuevaCfg, { merge: true });
  await registrarBitacora("CONFIGURACIÓN", `Se actualizó identidad del negocio a "${nuevaCfg.nombre}"`);
  alert("Identidad del negocio guardada y aplicada en todo el sistema.");
});