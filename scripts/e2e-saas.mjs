// E2E backend SaaS: node scripts/e2e-saas.mjs
const BASE = 'http://localhost:3000';
let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} - ${msg}`); if (!cond) fails++; };

async function call(method, url, body, cookie) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const setCookie = res.headers.get('set-cookie');
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json, cookie: setCookie ? setCookie.split(';')[0] : null };
}

const r401 = await call('GET', '/api/productos');
ok(r401.status === 401, 'Sin sesión -> 401');

const planes = await call('GET', '/api/planes');
ok(planes.status === 200 && planes.json.data.length === 4, 'Planes públicos (4)');

const login = await call('POST', '/api/auth/login', { email: 'facturacion@meetinlabs.com', password: process.env.SA_PASS });
ok(login.status === 200 && login.cookie, 'Login SuperAdmin');
const SA = login.cookie;

const me = await call('GET', '/api/auth/me', null, SA);
ok(me.json?.data?.user?.role === 'superadmin', `me role=${me.json?.data?.user?.role} plan=${me.json?.data?.suscripcion?.plan?.code}`);

const cfg = await call('GET', '/api/configuracion', null, SA);
ok(cfg.json?.data?.emisor?.cedula === '106630896' && cfg.json.data.hacienda?.enviarAHacienda === false, 'Config MeetinLabs migrada (enviarAHacienda=false)');
const facts = await call('GET', '/api/facturas', null, SA);
ok(facts.json?.data?.some(f => f.consecutivo === '00100001010000000041'), 'Factura 0041 migrada');
const cons = await call('GET', '/api/consecutivos', null, SA);
ok(cons.json?.data?.proximos?.['01'] === 42, `Próximo consecutivo 01 = ${cons.json?.data?.proximos?.['01']}`);
const prods = await call('GET', '/api/productos', null, SA);
const clis = await call('GET', '/api/clientes', null, SA);
ok(prods.json?.data?.length >= 1 && clis.json?.data?.length >= 1, `Productos=${prods.json?.data?.length} Clientes=${clis.json?.data?.length}`);

// Tenant B
const emailB = `e2e_${Date.now()}@test-saas.local`;
const reg = await call('POST', '/api/auth/register', { nombreEmpresa: 'E2E Tenant B', cedula: '3101999999', nombreUsuario: 'Usuario B', email: emailB, password: 'secreto123' });
ok(reg.status === 200 && reg.cookie, 'Registro Tenant B');
const B = reg.cookie;
const meB = await call('GET', '/api/auth/me', null, B);
const tenantB = meB.json?.data?.user?.tenantId;
ok(meB.json?.data?.suscripcion?.subscription?.status === 'trialing', `Tenant B status=${meB.json?.data?.suscripcion?.subscription?.status}`);
const pB = await call('GET', '/api/productos', null, B);
const cB = await call('GET', '/api/clientes', null, B);
const fB = await call('GET', '/api/facturas', null, B);
ok(pB.json?.data?.length === 0 && cB.json?.data?.length === 0 && fB.json?.data?.length === 0, 'Aislamiento: Tenant B no ve datos de MeetinLabs');
const xB = await call('GET', '/api/facturas/' + facts.json.data[0].clave + '/xml', null, B);
ok(xB.status === 404, 'Aislamiento: Tenant B no puede descargar XML ajeno');
const saB = await call('GET', '/api/superadmin/dashboard', null, B);
ok(saB.status === 403, 'Tenant B sin acceso SuperAdmin (403)');

// Crear producto en B
const newP = await call('POST', '/api/productos', { nombre: 'Prod B', precio: 1000, cabys: '8399000000000', categoria: 'General' }, B);
ok(newP.status === 200, 'Tenant B crea producto');
const pSA2 = await call('GET', '/api/productos', null, SA);
ok(!pSA2.json.data.some(p => p.nombre === 'Prod B'), 'MeetinLabs no ve producto de Tenant B');

// Checkout sandbox
const co = await call('POST', '/api/billing/checkout', { planCode: 'emprendedor', billingCycle: 'monthly' }, B);
ok(co.json?.data?.mode === 'sandbox', `Checkout modo=${co.json?.data?.mode}`);
const conf = await call('POST', '/api/billing/sandbox/confirmar', { transactionId: co.json?.data?.transactionId }, B);
ok(conf.json?.suscripcion?.subscription?.status === 'active' && conf.json.suscripcion.plan.code === 'emprendedor', 'Sandbox activa plan emprendedor');

// SINPE
const sinpe = await call('POST', '/api/billing/sinpe', { planCode: 'pro', billingCycle: 'monthly', referencia: 'SINPE-E2E-123' }, B);
ok(sinpe.status === 200, 'Reporte SINPE');
const dash = await call('GET', '/api/superadmin/dashboard', null, SA);
const pend = dash.json?.data?.pagosPendientes?.find(p => p.id === sinpe.json?.data?.id);
ok(Boolean(pend), `Dashboard SA muestra pago pendiente (MRR=${dash.json?.data?.kpis?.mrrUsd})`);
const apr = await call('POST', `/api/superadmin/pagos/${sinpe.json?.data?.id}/aprobar`, {}, SA);
ok(apr.status === 200, 'SA aprueba SINPE');
const est = await call('GET', '/api/billing/estado', null, B);
ok(est.json?.data?.plan?.code === 'pro', `Tenant B plan=${est.json?.data?.plan?.code}`);

// Usuarios
const u = await call('POST', '/api/usuarios', { nombre: 'Operador B', email: `op_${emailB}`, password: 'secreto123', role: 'operador' }, B);
ok(u.status === 200, 'Crear usuario operador en Tenant B');
const logout = await call('POST', '/api/auth/logout', {}, B);
ok(logout.status === 200, 'Logout');

console.log(`TENANT_B=${tenantB}`);
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILS`);
