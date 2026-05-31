#!/usr/bin/env node
// PayPal Sandbox에 Product + Plan을 생성하고 pricing.html을 자동 업데이트
//
// 실행 방법 (PowerShell):
//   $env:PAYPAL_SECRET="your_sandbox_secret"; node create-paypal-plan.js

const fs   = require('fs');
const path = require('path');

const CLIENT_ID = 'AWsxNSSxtH_lE9MyN4V1FFr6IVhMBIOsH7ugtyfTYMhR-LnWxpb9RwaJrQWHeMOkoAGS4Xui0Oi79vwA';
const SECRET    = process.env.PAYPAL_SECRET;
const BASE      = 'https://api-m.sandbox.paypal.com';

if (!SECRET) {
  console.error('오류: PAYPAL_SECRET 환경변수가 없습니다.');
  console.error('실행 예시: $env:PAYPAL_SECRET="your_secret"; node create-paypal-plan.js');
  process.exit(1);
}

async function getToken() {
  const creds = Buffer.from(`${CLIENT_ID}:${SECRET}`).toString('base64');
  const res = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Token 오류: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function createProduct(token) {
  const res = await fetch(`${BASE}/v1/catalogs/products`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `ssurd-product-${Date.now()}`,
    },
    body: JSON.stringify({
      name: 'Ssurd Starter',
      type: 'SERVICE',
      category: 'SOFTWARE',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Product 생성 오류: ${JSON.stringify(data)}`);
  console.log(`✓ Product 생성: ${data.id}`);
  return data.id;
}

async function createPlan(token, productId) {
  const res = await fetch(`${BASE}/v1/billing/plans`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': `ssurd-plan-${Date.now()}`,
    },
    body: JSON.stringify({
      product_id: productId,
      name: 'Starter Monthly',
      billing_cycles: [
        {
          frequency: { interval_unit: 'MONTH', interval_count: 1 },
          tenure_type: 'REGULAR',
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: {
            fixed_price: { value: '9.00', currency_code: 'USD' },
          },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: 'CONTINUE',
        payment_failure_threshold: 3,
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Plan 생성 오류: ${JSON.stringify(data)}`);
  console.log(`✓ Plan 생성: ${data.id}`);
  return data.id;
}

function updatePricingHtml(planId) {
  const htmlPath = path.join(__dirname, 'pricing.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const updated = html.replace(
    /const PAYPAL_PLAN_ID\s*=\s*'[^']*';/,
    `const PAYPAL_PLAN_ID   = '${planId}';`
  );
  if (html === updated) throw new Error('pricing.html에서 PAYPAL_PLAN_ID를 찾을 수 없습니다.');
  fs.writeFileSync(htmlPath, updated, 'utf8');
  console.log(`✓ pricing.html 업데이트 완료 → PAYPAL_PLAN_ID = '${planId}'`);
}

(async () => {
  try {
    console.log('PayPal Sandbox 연결 중...\n');
    const token     = await getToken();
    console.log('✓ 인증 성공\n');
    const productId = await createProduct(token);
    const planId    = await createPlan(token, productId);
    updatePricingHtml(planId);
    console.log('\n============================');
    console.log('Plan ID:', planId);
    console.log('============================');
  } catch (e) {
    console.error('\n오류:', e.message);
    process.exit(1);
  }
})();
