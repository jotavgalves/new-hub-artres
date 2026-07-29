(() => {
  'use strict';

  const MARKER = 'site-v2-visual-checkout-bridge-v1';
  const ROUTE = '/api/orders/v2';
  const DRAFT_KEY = 'armazem:v2-checkout-customer-draft';
  const RESULT_KEY = 'armazem:v2-checkout-last-result';
  let inFlight = false;
  let activeDialog = null;

  document.documentElement.dataset.v2CheckoutBridge = MARKER;
  document.addEventListener('click', event => {
    const anchor = event.target?.closest?.('a.wa');
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();

    if (inFlight) {
      notify('Seu pedido já está sendo enviado.');
      return;
    }

    const snapshot = readVisualState(anchor);
    if (!snapshot.ok) {
      notify(snapshot.message);
      return;
    }

    showCustomerDialog(snapshot);
  }, true);

  function readVisualState(anchor) {
    const lines = typeof cart !== 'undefined' && Array.isArray(cart) ? cart : [];
    const sellerId = typeof seller !== 'undefined' ? String(seller || '').trim() : '';
    const sellers = typeof SELLERS !== 'undefined' && SELLERS && typeof SELLERS === 'object'
      ? SELLERS
      : {};
    const sellerProfile = sellers[sellerId] || null;
    const whatsappUrl = typeof waUrl === 'function' ? String(waUrl() || '') : String(anchor.href || '');

    if (anchor.classList.contains('disabled') || !lines.length) {
      return { ok: false, message: 'Revise o carrinho antes de enviar.' };
    }
    if (!sellerId || !sellerProfile) {
      return { ok: false, message: 'Escolha uma vendedora antes de enviar.' };
    }
    if (!/^https:\/\/wa\.me\//.test(whatsappUrl)) {
      return { ok: false, message: 'Não foi possível preparar o WhatsApp.' };
    }

    try {
      return {
        ok: true,
        anchor,
        whatsappUrl,
        seller: {
          id: sellerId,
          label: String(sellerProfile.label || sellerId).trim()
        },
        items: lines.map(mapCartItem)
      };
    } catch (error) {
      return { ok: false, message: messageForError(error?.message) };
    }
  }

  function mapCartItem(item) {
    const details = clonePlain(item?.details || {});
    const productKey = clean(item?.productKey || item?.product);
    const isBag = productKey === 'sacolinha';
    const driveFileId = clean(item?.driveFileId || item?.id);
    const variantKey = clean(
      item?.variantKey || details.variantKey || details.variant || (isBag ? details.size : '') || 'default'
    );
    const sizeKey = clean(
      item?.sizeKey || details.sizeKey || (isBag ? 'default' : item?.size || details.size) || 'default'
    );
    const quantity = positiveInteger(item?.quantity ?? item?.qty);

    if (!driveFileId) throw new Error('CART_ITEM_ID_REQUIRED');
    if (!productKey) throw new Error('CART_ITEM_PRODUCT_REQUIRED');
    if (!quantity) throw new Error('CART_ITEM_QUANTITY_INVALID');

    return {
      driveFileId,
      productKey,
      variantKey,
      sizeKey,
      quantity,
      details
    };
  }

  function showCustomerDialog(snapshot) {
    closeDialog();
    const draft = readDraft();
    const backdrop = document.createElement('div');
    backdrop.className = 'v2CheckoutBackdrop';
    backdrop.innerHTML = `
      <style>
        .v2CheckoutBackdrop{position:fixed;inset:0;z-index:100000;display:grid;place-items:center;padding:18px;background:rgba(34,33,36,.58);backdrop-filter:blur(8px)}
        .v2CheckoutDialog{width:min(100%,430px);border-radius:26px;background:#fff;padding:24px;box-shadow:0 30px 90px rgba(0,0,0,.28);font-family:"Plus Jakarta Sans",Arial,sans-serif;color:#222124}
        .v2CheckoutDialog h2{margin:0 0 8px;font-family:Montserrat,Arial,sans-serif;font-size:23px;letter-spacing:-.04em}
        .v2CheckoutDialog p{margin:0 0 18px;color:#6c6670;font-size:13px;line-height:1.55}
        .v2CheckoutField{display:grid;gap:7px;margin:0 0 13px}.v2CheckoutField span{font-size:11px;font-weight:900;letter-spacing:.06em;text-transform:uppercase;color:#6d6870}
        .v2CheckoutField input{width:100%;height:50px;border:1px solid #e5dedd;border-radius:15px;padding:0 14px;outline:none;font:inherit}.v2CheckoutField input:focus{border-color:#ef5585;box-shadow:0 0 0 4px rgba(239,85,133,.12)}
        .v2CheckoutActions{display:grid;grid-template-columns:1fr 1.4fr;gap:10px;margin-top:18px}.v2CheckoutActions button{min-height:48px;border-radius:15px;font:inherit;font-weight:900;cursor:pointer}
        .v2CheckoutCancel{border:1px solid #e9e1df;background:#fff;color:#5a535a}.v2CheckoutSend{border:0;background:linear-gradient(135deg,#25d366,#128c49);color:#fff}.v2CheckoutSend:disabled{opacity:.55;cursor:wait}
        .v2CheckoutError{min-height:18px;margin-top:10px;color:#a62f50;font-size:12px;font-weight:800}
      </style>
      <form class="v2CheckoutDialog" role="dialog" aria-modal="true" aria-labelledby="v2CheckoutTitle">
        <h2 id="v2CheckoutTitle">Confirmar seus dados</h2>
        <p>O pedido será registrado com segurança antes de abrir a conversa no WhatsApp.</p>
        <label class="v2CheckoutField"><span>Seu nome</span><input name="customerName" maxlength="160" autocomplete="name" required></label>
        <label class="v2CheckoutField"><span>WhatsApp com DDD</span><input name="customerWhatsapp" inputmode="tel" maxlength="20" autocomplete="tel" required></label>
        <div class="v2CheckoutActions"><button type="button" class="v2CheckoutCancel">Cancelar</button><button type="submit" class="v2CheckoutSend">Registrar e abrir WhatsApp</button></div>
        <div class="v2CheckoutError" aria-live="polite"></div>
      </form>`;

    const form = backdrop.querySelector('form');
    const nameInput = form.elements.customerName;
    const phoneInput = form.elements.customerWhatsapp;
    nameInput.value = draft.name || '';
    phoneInput.value = draft.whatsapp || '';
    phoneInput.addEventListener('input', () => {
      phoneInput.value = phoneInput.value.replace(/[^0-9()+\-\s]/g, '');
    });
    backdrop.querySelector('.v2CheckoutCancel').addEventListener('click', closeDialog);
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeDialog();
    });
    form.addEventListener('submit', event => submitVisualCheckout(event, snapshot, form));
    document.body.append(backdrop);
    activeDialog = backdrop;
    setTimeout(() => (nameInput.value ? phoneInput : nameInput).focus(), 0);
  }

  async function submitVisualCheckout(event, snapshot, form) {
    event.preventDefault();
    if (inFlight) return;

    const name = clean(form.elements.customerName.value).slice(0, 160);
    const whatsapp = digits(form.elements.customerWhatsapp.value).slice(0, 20);
    const errorBox = form.querySelector('.v2CheckoutError');
    const submitButton = form.querySelector('.v2CheckoutSend');

    if (!name) {
      errorBox.textContent = 'Informe seu nome.';
      form.elements.customerName.focus();
      return;
    }
    if (whatsapp.length < 10) {
      errorBox.textContent = 'Informe um WhatsApp válido com DDD.';
      form.elements.customerWhatsapp.focus();
      return;
    }

    writeDraft({ name, whatsapp });
    const popup = window.open('', '_blank');
    if (popup) {
      popup.document.title = 'Preparando seu pedido';
      popup.document.body.textContent = 'Registrando seu pedido com segurança...';
    }

    inFlight = true;
    submitButton.disabled = true;
    errorBox.textContent = '';

    try {
      const intent = {
        seller: snapshot.seller,
        customer: { name, whatsapp },
        items: snapshot.items
      };
      const idempotencyKey = await createIdempotencyKey(intent);
      const response = await fetch(ROUTE, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
          'X-Request-Id': `visual-${Date.now().toString(36)}`
        },
        body: JSON.stringify({
          submissionCreatedAt: new Date().toISOString(),
          ...intent
        })
      });
      const payload = await response.json().catch(() => ({}));
      const accepted = (response.status === 201 && payload.action === 'CREATED') ||
        (response.status === 200 && payload.action === 'REPLAY');
      if (!accepted || payload.ok !== true || !payload.orderNumber) {
        throw new Error(publicError(payload.error, response.status));
      }

      sessionStorage.setItem(RESULT_KEY, JSON.stringify({
        orderNumber: payload.orderNumber,
        action: payload.action,
        at: new Date().toISOString()
      }));
      notify(`Pedido ${payload.orderNumber} registrado. Abrindo o WhatsApp.`);
      closeDialog();
      if (popup) popup.location.replace(snapshot.whatsappUrl);
      else window.location.assign(snapshot.whatsappUrl);
    } catch (error) {
      if (popup) popup.close();
      errorBox.textContent = messageForError(error?.message);
      notify(errorBox.textContent);
    } finally {
      inFlight = false;
      submitButton.disabled = false;
    }
  }

  async function createIdempotencyKey(intent) {
    const canonical = stableSerialize({
      seller: intent.seller,
      customer: intent.customer,
      items: [...intent.items].sort((left, right) => identity(left).localeCompare(identity(right)))
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    const hex = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    return `web-v2-${hex.slice(0, 56)}`;
  }

  function identity(item) {
    return [item.driveFileId, item.productKey, item.variantKey, item.sizeKey].join(':');
  }

  function stableSerialize(value) {
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }

  function clonePlain(value) {
    return JSON.parse(JSON.stringify(value && typeof value === 'object' ? value : {}));
  }

  function publicError(code, status) {
    const safe = /^[A-Z0-9_]{3,100}$/.test(String(code || '')) ? code : `HTTP_${status}`;
    return safe;
  }

  function messageForError(code) {
    const messages = {
      CART_ITEM_ID_REQUIRED: 'Uma arte do carrinho não possui identificação válida.',
      CART_ITEM_PRODUCT_REQUIRED: 'Um produto do carrinho não pôde ser identificado.',
      CART_ITEM_QUANTITY_INVALID: 'Revise a quantidade dos itens do carrinho.',
      CUSTOMER_NAME_REQUIRED: 'Informe seu nome.',
      CUSTOMER_WHATSAPP_INVALID: 'Informe um WhatsApp válido com DDD.',
      PUBLIC_CHECKOUT_DISABLED: 'O checkout está temporariamente indisponível.',
      PUBLIC_CHECKOUT_RATE_LIMITED: 'Aguarde um minuto antes de tentar novamente.',
      IDEMPOTENCY_KEY_CONFLICT: 'O carrinho mudou durante o envio. Tente novamente.',
      ORDER_QUANTITY_RULES_INVALID: 'Revise as quantidades mínimas do carrinho.'
    };
    return messages[code] || 'Não foi possível registrar o pedido agora. Revise os dados e tente novamente.';
  }

  function readDraft() {
    try {
      return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  function writeDraft(value) {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value));
    } catch (_) {}
  }

  function closeDialog() {
    if (activeDialog) activeDialog.remove();
    activeDialog = null;
  }

  function notify(message) {
    if (typeof toast === 'function') {
      toast(message);
      return;
    }
    let status = document.getElementById('v2CheckoutStatus');
    if (!status) {
      status = document.createElement('div');
      status.id = 'v2CheckoutStatus';
      status.setAttribute('role', 'status');
      status.style.cssText = 'position:fixed;z-index:100001;left:16px;right:16px;bottom:16px;padding:14px;border-radius:14px;background:#222124;color:#fff;text-align:center;font:700 13px Arial';
      document.body.append(status);
    }
    status.textContent = message;
    setTimeout(() => status.remove(), 5000);
  }

  function positiveInteger(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  function digits(value) {
    return String(value ?? '').replace(/\D/g, '');
  }

  function clean(value) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }
})();
