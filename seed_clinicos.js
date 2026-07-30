/**
 * seed_clinicos.js — Datos de prueba para parámetros clínicos, psicotécnico y profesionales
 */

const { db } = require('./db');

// Profesionales de Sanidad (ejemplo)
const HEALTH_PROFESSIONALS = [
  { matricula: 'MED-001', nombre: 'Juan', apellido: 'García', especialidad: 'Medicina General', firma_digital: 'FIRMA_JG_001' },
  { matricula: 'PSI-001', nombre: 'María', apellido: 'López', especialidad: 'Psicología Laboral', firma_digital: 'FIRMA_ML_001' },
  { matricula: 'LAB-001', nombre: 'Carlos', apellido: 'Pérez', especialidad: 'Análisis Clínico', firma_digital: 'FIRMA_CP_001' }
];

// Parámetros Clínicos por tipo de examen
const CLINICAL_PARAMETERS = [
  // Radiografía
  { tipo_examen: 'Radiografía', codigo: 'RX-TORAX', nombre: 'Radiografía de Tórax', descripcion: 'Evaluación de pulmones y corazón', unidad: 'visual', orden: 1 },
  { tipo_examen: 'Radiografía', codigo: 'RX-COLUMNA', nombre: 'Radiografía de Columna', descripcion: 'Evaluación de columna vertebral', unidad: 'visual', orden: 2 },
  
  // Laboratorio
  { tipo_examen: 'Laboratorio', codigo: 'LAB-HEMO', nombre: 'Hemoglobina', descripcion: 'Nivel de hemoglobina en sangre', unidad: 'g/dL', rango_minimo: 12, rango_maximo: 18, orden: 1 },
  { tipo_examen: 'Laboratorio', codigo: 'LAB-GLUCOSA', nombre: 'Glucosa en Ayuno', descripcion: 'Nivel de glucosa en sangre', unidad: 'mg/dL', rango_minimo: 70, rango_maximo: 100, orden: 2 },
  { tipo_examen: 'Laboratorio', codigo: 'LAB-COLESTEROL', nombre: 'Colesterol Total', descripcion: 'Nivel de colesterol', unidad: 'mg/dL', rango_minimo: 0, rango_maximo: 200, orden: 3 },
  { tipo_examen: 'Laboratorio', codigo: 'LAB-TRIGLICERIDOS', nombre: 'Triglicéridos', descripcion: 'Nivel de triglicéridos', unidad: 'mg/dL', rango_minimo: 0, rango_maximo: 150, orden: 4 }
];

// Indicadores Psicotécnicos
const PSYCHOMETRIC_INDICATORS = [
  { codigo: 'PSY-ATENCION', nombre: 'Atención y Concentración', descripcion: 'Capacidad de mantener atención sostenida', categoria: 'Cognitivo', orden: 1 },
  { codigo: 'PSY-REACCION', nombre: 'Tiempo de Reacción', descripcion: 'Rapidez en responder a estímulos', categoria: 'Cognitivo', orden: 2 },
  { codigo: 'PSY-STRESS', nombre: 'Tolerancia al Estrés', descripcion: 'Capacidad de manejar presión', categoria: 'Emocional', orden: 3 },
  { codigo: 'PSY-PERSONALIDAD', nombre: 'Estabilidad Emocional', descripcion: 'Equilibrio emocional general', categoria: 'Personalidad', orden: 4 },
  { codigo: 'PSY-VISION', nombre: 'Agudeza Visual', descripcion: 'Capacidad visual general', categoria: 'Física', orden: 5 },
  { codigo: 'PSY-AUDICION', nombre: 'Audición', descripcion: 'Capacidad auditiva general', categoria: 'Física', orden: 6 }
];

function seedClinicos() {
  try {
    console.log('🌱 Poblando tablas de parámetros clínicos...');
    
    // Insertar profesionales
    HEALTH_PROFESSIONALS.forEach(prof => {
      try {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO health_professionals 
          (matricula, nombre, apellido, especialidad, firma_digital) 
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(prof.matricula, prof.nombre, prof.apellido, prof.especialidad, prof.firma_digital);
        console.log(`✓ Profesional: ${prof.nombre} ${prof.apellido}`);
      } catch (e) {
        console.log(`⚠ Profesional ya existe: ${prof.matricula}`);
      }
    });
    
    // Insertar parámetros clínicos
    CLINICAL_PARAMETERS.forEach(param => {
      try {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO clinical_parameters 
          (tipo_examen, codigo, nombre, descripcion, unidad, rango_minimo, rango_maximo, orden) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(param.tipo_examen, param.codigo, param.nombre, param.descripcion, param.unidad, param.rango_minimo || null, param.rango_maximo || null, param.orden);
        console.log(`✓ Parámetro: ${param.nombre}`);
      } catch (e) {
        console.log(`⚠ Parámetro ya existe: ${param.codigo}`);
      }
    });
    
    // Insertar indicadores psicotécnicos
    PSYCHOMETRIC_INDICATORS.forEach(ind => {
      try {
        const stmt = db.prepare(`
          INSERT OR IGNORE INTO psychometric_indicators 
          (codigo, nombre, descripcion, categoria, orden) 
          VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run(ind.codigo, ind.nombre, ind.descripcion, ind.categoria, ind.orden);
        console.log(`✓ Indicador: ${ind.nombre}`);
      } catch (e) {
        console.log(`⚠ Indicador ya existe: ${ind.codigo}`);
      }
    });
    
    console.log('\n✅ Datos de parámetros clínicos cargados correctamente.\n');
  } catch (err) {
    console.error('❌ Error poblando datos:', err.message);
  }
}

// Ejecutar si se llama directamente
if (require.main === module) {
  seedClinicos();
}

module.exports = { seedClinicos, CLINICAL_PARAMETERS, PSYCHOMETRIC_INDICATORS, HEALTH_PROFESSIONALS };