// =====================================================================
// JARVIS CATÁLOGO LOCAL — Repuestos y lubricantes (Venezuela).
// Memoria persistente para responder INSTANTÁNEO y SIN INTERNET.
// Las imágenes se cachean en disco local (ver main.js) pero los DATOS
// de cada ficha están aquí, siempre disponibles.
// =====================================================================
(function () {
  const CATALOGO = {
    version: 1,
    actualizado: "2026",
    categorias: {
      LUBRICANTES: "Aceites y lubricantes de motor por marca y viscosidad",
      FILTROS: "Filtros de aceite, aire, combustible y cabina",
      ELECTRICAS: "Componentes eléctricos (bujías, alternadores, baterías y más)",
      FRENOS: "Piezas de freno (pastillas, discos, zapatas)",
      SUSPENSION: "Amortiguadores, rodillos y componentes de suspensión",
      CORREAS: "Correas de motor (distribución y accesorios)"
    }
  };

  // ===================== LUBRICANTES (aceites de motor) =====================
  // Cada ficha: marca, viscosidad, base, para, envases, img (clave de imagen local)
  const lubricantes = [
    { nombre: "Aceite de motor 20W50", marca: "Mobil Super", visc: "20W50", base: "Mineral", tipo: "Motor gasolina / diésel ligero",
      para: "La viscosidad más usada en Venezuela por clima cálido y motores de alto kilometraje.", envases: ["1L", "4L", "5L"],
      img: "oil_20w50" },
    { nombre: "Aceite de motor 15W40", marca: "Mobil Delvac", visc: "15W40", base: "Mineral/Semi", tipo: "Motor diésel y camionetas",
      para: "Recomendado para pickups, camionetas y motores turbodiésel ligeros.", envases: ["1L", "4L", "5L"], img: "oil_15w40" },
    { nombre: "Aceite de motor 10W30", marca: "Castrol GTX", visc: "10W30", base: "Semi-sintético", tipo: "Motor gasolina",
      para: "Ideal para motores modernos de gasolina con arranque rápido en frío.", envases: ["1L", "4L"], img: "oil_10w30" },
    { nombre: "Aceite de motor 5W30", marca: "Shell Helix", visc: "5W30", base: "Sintético", tipo: "Motor gasolina moderno",
      para: "Protección superior en arranques en frío y ahorro de combustible.", envases: ["1L", "4L"], img: "oil_5w30" },
    { nombre: "Aceite de motor 5W40", marca: "Total Quartz", visc: "5W40", base: "Sintético", tipo: "Motor gasolina/diésel",
      para: "Amplio rango de temperatura, apto para motores turbo y de alta exigencia.", envases: ["1L", "4L"], img: "oil_5w40" },
    { nombre: "Aceite de motor 0W20", marca: "Mobil 1", visc: "0W20", base: "Sintético", tipo: "Motor gasolina moderno",
      para: "Baja viscosidad para motores modernos; reduce fricción y consumo.", envases: ["1L", "4L"], img: "oil_0w20" },
    { nombre: "Aceite de caja de cambios", marca: "Mobilube", visc: "75W90 / 80W90", base: "Mineral", tipo: "Caja manual/automática",
      para: "Lubricante para caja de cambios y diferencial; soporta alta presión.", envases: ["1L", "4L"], img: "oil_gear" },
    { nombre: "Líquido de frenos DOT 3/4", marca: "FORG / Bosch", visc: "DOT3·4·5.1", base: "Glicol", tipo: "Sistema de frenos",
      para: "Transmisor de presión hidráulica de frenos; cambiar según especificación del vehículo.", envases: ["250ml", "1L"], img: "flu_brake" },
    { nombre: "Refrigerante anticongelante", marca: "Prestone", visc: "G12/G13", base: "Etilenglicol", tipo: "Sistema de enfriamiento",
      para: "Mantiene la temperatura del motor y protege contra corrosión y heladas.", envases: ["1L", "5L"], img: "flu_coolant" },
    { nombre: "Aceite hidráulico", marca: "Hidraúlico 10W", visc: "ISO 46 / 32", base: "Mineral", tipo: "Dirección y maquinaria",
      para: "Para sistemas hidráulicos: dirección asistida, gatos y maquinaria pesada.", envases: ["1L", "4L", "5L"], img: "oil_hydr" }
  ];

  // ===================== REPUESTOS / AUTOPARTES =====================
  const repuestos = [
    { nombre: "Filtro de aceite", marca: "FRAM / WEGA", tipo: "Motor",
      para: "Retiene impurezas del aceite; cambiar con cada cambio de lubricante.", img: "fil_aceite" },
    { nombre: "Filtro de aire", marca: "FRAM / Mann", tipo: "Admisión",
      para: "Filtra el aire de admisión; mejora la combustión y el consumo.", img: "fil_aire" },
    { nombre: "Filtro de combustible", marca: "Bosch / WEGA", tipo: "Inyección",
      para: "Retiene partículas del combustible para proteger los inyectores.", img: "fil_comb" },
    { nombre: "Bujía de encendido", marca: "NGK / Bosch", tipo: "Eléctrica",
      para: "Genera la chispa de encendido; verificar calibración y desgaste.", img: "ele_bujia" },
    { nombre: "Batería de auto", marca: "Borri / Intersec", tipo: "Eléctrica",
      para: "Almacena energía para el arranque y sistemas eléctricos.", img: "ele_bateria" },
    { nombre: "Alternador", marca: "Bosch / Valeo", tipo: "Eléctrica",
      para: "Genera la corriente para el vehículo y carga la batería.", img: "ele_alternador" },
    { nombre: "Arranque (motor de marcha)", marca: "Bosch / Denso", tipo: "Eléctrica",
      para: "Enciende el motor al girar el cigüeñal.", img: "ele_arranque" },
    { nombre: "Pastillas de freno delanteras", marca: "Brembo / Ferodo", tipo: "Frenos",
      para: "Fricción de frenado en discos delanteros; revisar grosor.", img: "fre_pastilla" },
    { nombre: "Disco de freno", marca: "Brembo / TRW", tipo: "Frenos",
      para: "Superficie de fricción de las pastillas; revisar rayones y espesor.", img: "fre_disco" },
    { nombre: "Amortiguador", marca: "Monroe / KYB", tipo: "Suspensión",
      para: "Controla el rebote del vehículo y mejora la estabilidad.", img: "sus_amortiguador" },
    { nombre: "Correa de accesorios", marca: "Gates / Dayco", tipo: "Correas",
      para: "Transmite el movimiento del motor a accesorios (alternador, A/C).", img: "cor_accesorios" },
    { nombre: "Correa de distribución", marca: "Gates / Contitech", tipo: "Correas",
      para: "Sincroniza el cigüeñal y el árbol de levas; cambio preventivo.", img: "cor_distribucion" }
  ];

  function todos() { return lubricantes.concat(repuestos); }

  // Busca una ficha por palabra clave (nombre, marca, viscosidad, tipo).
  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/[áàäâ]/g, "a").replace(/[éèëê]/g, "e")
      .replace(/[íìïî]/g, "i").replace(/[óòöô]/g, "o")
      .replace(/[úùüû]/g, "u").replace(/ñ/g, "n");
  }
  function buscar(q) {
    const palabras = norm(q).split(/\s+/).filter(Boolean);
    if (!palabras.length) return [];
    const scored = [];
    todos().forEach(f => {
      const nombre = norm(f.nombre + " " + (f.marca || "") + " " + (f.visc || "") + " " + (f.tipo || ""));
      const completo = norm(f.nombre + " " + (f.marca || "") + " " + (f.visc || "") + " " + (f.tipo || "") + " " + (f.para || ""));
      let score = 0;
      if (completo.indexOf(norm(q)) !== -1) score += 6;
      // Cada palabra que aparezca en la ficha suma; y si TODAS aparecen en
      // el nombre/marca/viscosidad sumamos una bonificación fuerte.
      let enNombre = 0;
      palabras.forEach(p => { if (completo.indexOf(p) !== -1) { score += 1; if (nombre.indexOf(p) !== -1) { enNombre++; } } });
      if (enNombre === palabras.length && palabras.length >= 2) score += 10;
      if (score > 0) scored.push({ f, score, exact: score >= 10 });
    });
    scored.sort((a, b) => b.score - a.score);
    const maxScore = scored.length ? scored[0].score : 0;
    if (maxScore >= 10) return scored.filter(x => x.score >= 10 || (x.score >= 8 && x.exact)).map(x => x.f);
    return scored.filter(x => x.score >= 2).map(x => x.f);
  }

  // Describe una ficha en texto legible para voz.
  function describir(f) {
    const marca = f.marca ? " Marca: " + f.marca + "." : "";
    const visc = f.visc ? " Viscosidad: " + f.visc + "." : "";
    const tipo = f.tipo ? " Tipo: " + f.tipo + "." : "";
    return f.nombre + "." + marca + visc + tipo + " " + (f.para || "");
  }

  window.JarvisCatalogo = { CATALOGO, lubricantes, repuestos, todos, buscar, describir };
})();