/* =================================================================================
  1. PUBSUB EVENT BUS
================================================================================== */
const pubsub = {
  events: {},
  subscribe: function(eventName, fn) {
    this.events[eventName] = this.events[eventName] || [];
    this.events[eventName].push(fn);
  },
  publish: function(eventName, data) {
    if (this.events[eventName]) {
      this.events[eventName].forEach(fn => { fn(data); });
    }
  }
};

/* =================================================================================
  2. GLOBAL STATE & UTILITIES
================================================================================== */
const CART_TYPE = document.body.getAttribute('data-cart-type') || 'drawer';

function debounce(fn, wait) {
    let t;
    return (...args) => {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}

function formatMoney(cents, format) {
  if (typeof cents === 'string') { cents = cents.replace('.', ''); }
  let value = '';
  const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
  const formatString = (format || window.Shopify.money_format);
  function defaultOption(opt, def) { return (typeof opt == 'undefined' ? def : opt); }
  function formatWithDelimiters(number, precision, thousands, decimal) {
    precision = defaultOption(precision, 2);
    thousands = defaultOption(thousands, ',');
    decimal = defaultOption(decimal, '.');
    if (isNaN(number) || number == null) { return 0; }
    number = (number / 100.0).toFixed(precision);
    let parts = number.split('.');
    let dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
    let cents = parts[1] ? (decimal + parts[1]) : '';
    return dollars + cents;
  }
  switch (formatString.match(placeholderRegex)[1]) {
    case 'amount_no_decimals': value = formatWithDelimiters(cents, 0); break;
    case 'amount_with_comma_separator': value = formatWithDelimiters(cents, 2, '.', ','); break;
    case 'amount_no_decimals_with_comma_separator': value = formatWithDelimiters(cents, 0, '.', ','); break;
    default: value = formatWithDelimiters(cents, 2); break;
  }
  return formatString.replace(placeholderRegex, value);
}

/* =================================================================================
  3. CART COMPONENTS
================================================================================== */

if (!customElements.get('product-form')) {
  customElements.define('product-form', class ProductForm extends HTMLElement {
    constructor() {
      super();
      this.form = this.querySelector('form');
      this.submitButton = this.querySelector('[type="submit"]');
      this.form.addEventListener('submit', this.onSubmitHandler.bind(this));
      
      // Get the cart notification element by its proper tag name
      this.cartNotification = document.querySelector('cart-notification');
    }

    onSubmitHandler(evt) {
      evt.preventDefault();
      if (this.submitButton.classList.contains('loading')) return;

      this.submitButton.setAttribute('aria-disabled', true);
      this.submitButton.classList.add('loading');

      const formData = new FormData(this.form);
      
      fetch('/cart/add.js', {
        method: 'POST',
        body: formData,
        headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' },
      })
      .then(response => response.json())
      .then(response => {
        if (response.status) {
          alert(response.description || 'An error occurred.');
          return;
        }

        // Publish the global cart update FIRST
        pubsub.publish('cart:updated', { source: 'product-form', cart: response });

        // FIX: Only show notification if cart type isn't 'drawer' or 'page'
        if (CART_TYPE !== 'drawer' && CART_TYPE !== 'page' && this.cartNotification) {
          this.cartNotification.renderContents(response);
        }
      })
      .catch(e => console.error(e))
      .finally(() => {
        this.submitButton.classList.remove('loading');
        this.submitButton.removeAttribute('aria-disabled');
      });
    }
  });
}

// FIX: Define the custom element with its correct tag name 'cart-notification'
if (!customElements.get('cart-notification')) {
  customElements.define('cart-notification', class CartNotification extends HTMLElement {
    constructor() {
      super();
      this.notificationWrapper = this.querySelector('.cart-notification-wrapper');
      
      this.addEventListener('click', (event) => {
        if (event.target === this.notificationWrapper || event.target.closest('.cart-notification__close')) {
          this.close();
        }
      });
    }

    open() {
      this.classList.add('is-visible');
      document.body.style.overflow = 'hidden';
      this.closeTimer = setTimeout(() => this.close(), 6000);
    }

    close() {
      this.classList.remove('is-visible');
      document.body.style.overflow = '';
      if(this.closeTimer) clearTimeout(this.closeTimer);
    }

    renderContents(addedItem) {
      const imageEl = this.querySelector('[data-notification-image]');
      const titleEl = this.querySelector('[data-notification-title]');
      const optionsEl = this.querySelector('[data-notification-options]');
      const cartCountEl = this.querySelector('[data-notification-cart-count]');
      
      if (addedItem.featured_image && addedItem.featured_image.url) {
        imageEl.src = addedItem.featured_image.url;
        imageEl.alt = addedItem.featured_image.alt;
        imageEl.style.display = 'block';
      } else {
        imageEl.style.display = 'none';
      }

      titleEl.textContent = addedItem.product_title;
      
      optionsEl.innerHTML = '';
      if (addedItem.variant_title && addedItem.variant_title !== 'Default Title') {
        const dd = document.createElement('dd');
        dd.textContent = addedItem.variant_title;
        optionsEl.appendChild(dd);
      }
      
      fetch('/cart.js')
        .then(res => res.json())
        .then(cart => {
            const viewCartText = cartCountEl.textContent.split('(')[0];
            cartCountEl.textContent = `${viewCartText}(${cart.item_count})`;
        });

      this.open();
    }
  });
}

if (!customElements.get('cart-drawer')) {
  customElements.define('cart-drawer', class CartDrawer extends HTMLElement {
    constructor() {
      super();
      this.debouncedUpdate = debounce(this.updateQuantity.bind(this), 400);
      this.drawerContent = this.querySelector('.cart-drawer');

      this.drawerContent.addEventListener('click', (event) => {
        const target = event.target;
        const quantityButton = target.closest('.quantity__button');
        const removeLink = target.closest('.remove-button');

        if (quantityButton || removeLink) {
          event.preventDefault();
          const lineItem = target.closest('.cart-item-row');
          const line = lineItem.dataset.line;
          const input = lineItem.querySelector('.quantity__input');
          let newQuantity;
          if(removeLink) {
            newQuantity = 0;
          } else {
            const currentVal = Number(input.value);
            newQuantity = quantityButton.name === 'plus' ? currentVal + 1 : currentVal - 1;
          }
          if (newQuantity >= 0) {
            if(input) input.value = newQuantity;
            this.debouncedUpdate(line, newQuantity);
          }
        }
      });
      
      const closeButton = this.querySelector('.cart-close');
      const overlay = document.querySelector('.cart-overlay');
      if(closeButton) closeButton.addEventListener('click', (e) => { e.preventDefault(); this.close(); });
      if(overlay) overlay.addEventListener('click', () => this.close());
      this.drawerContent.addEventListener('click', (e) => e.stopPropagation());

      pubsub.subscribe('cart:updated', () => this.renderContents());
      
      const cartIcon = document.getElementById('cart-icon-bubble');
      if (cartIcon && CART_TYPE === 'drawer') {
        cartIcon.addEventListener('click', (e) => {
          e.preventDefault();
          this.open();
        });
      }
    }

    open() {  
      this.drawerContent.removeAttribute('inert');
      this.drawerContent.classList.add('active');  
      document.querySelector('.cart-overlay').classList.add('active');  
      document.body.style.overflow = 'hidden';  
      this.renderContents();
    }

    close() {  
      this.drawerContent.setAttribute('inert', '');
      this.drawerContent.classList.remove('active');  
      document.querySelector('.cart-overlay').classList.remove('active');  
      document.body.style.overflow = '';  
    }

    updateQuantity(line, quantity) {
        this.drawerContent.style.pointerEvents = 'none';
        fetch('/cart/change.js', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ line: line, quantity: quantity })
        })
        .then(response => response.json())
        .then(cartState => {
            pubsub.publish('cart:updated', { source: 'cart-drawer', cart: cartState });
        }).finally(() => {
            this.drawerContent.style.pointerEvents = 'auto';
        });
    }

    async renderContents() {
      const res = await fetch('/cart.js');
      const cart = await res.json();
      
      const itemsContainer = this.querySelector('.cart-drawer__items');
      const footer = this.querySelector('.cart-drawer__footer');
      const subtotalEl = this.querySelector('.cart-drawer__subtotal');
      let itemsHTML = '';

      if (cart.item_count === 0) {
        itemsHTML = '<div class="cart-drawer__empty mt-48"><p class="h3 text-center text-gold">Your bag is empty</p></div>';
        if (footer) footer.style.display = 'none';
      } else {
        if (footer) footer.style.display = 'block';
        cart.items.forEach((item, index) => {
          itemsHTML += `
            <div class="cart-item-row flex py-4 border-t border-silver" data-line="${index + 1}">
              <a href="${item.url}" class="block w-1/3 aspect-square placeholder">
                <img src="${item.image}" alt="${item.product_title}" class="object-cover w-full h-full" loading="lazy">
              </a>
              <div class="flex flex-col w-2/3 pl-3.5 pb-0.5">
                <div class="flex grow justify-between">
                  <div>
                    <a href="${item.url}" class="link inline-block font-medium text-[15px] uppercase tracking-wide">
                      ${item.product_title}
                    </a>
                    ${item.variant_title ? `<div class="pa2 !text-xs mt-1">${item.variant_title}</div>` : ''}
                  </div>
                  <div class="pl-3 font-medium text-right text-sm uppercase tracking-wider">
                    ${formatMoney(item.final_line_price)}
                  </div>
                </div>
                <div class="flex shrink justify-between mt-2">
                  <div class="quantity">
                    <button type="button" name="minus" class="quantity__button" data-line="${index + 1}">-</button>
                    <input type="number" class="quantity__input" value="${item.quantity}" readonly>
                    <button type="button" name="plus" class="quantity__button" data-line="${index + 1}">+</button>
                  </div>
                  <a href="/cart/change?line=${index + 1}&quantity=0" class="link remove-button">
                      <small class="text-[10px] uppercase tracking-wider">Remove</small>
                  </a>
                </div>
              </div>
            </div>`;
        });
      }
      itemsContainer.innerHTML = itemsHTML;
      if (subtotalEl) subtotalEl.textContent = formatMoney(cart.total_price);
    }
  });
}

if (!customElements.get('cart-items')) {
  customElements.define('cart-items', class CartItems extends HTMLElement {
    constructor() {
      super();
      this.debouncedUpdate = debounce(this.updateQuantity.bind(this), 400);
      this.addEventListener('click', this.handleItemClick.bind(this));

      pubsub.subscribe('cart:updated', () => {
        if (window.location.pathname.startsWith('/cart')) {
          this.renderContents();
        }
      });
    }

    handleItemClick(event) {
      const target = event.target;
      const removeLink = target.closest('.remove-button'); 
      const quantityButton = target.closest('.quantity__button');

      if (!quantityButton && !removeLink) return;

      event.preventDefault();
      const lineItem = target.closest('.cart-item-row');
      if (!lineItem) return; 
      
      const line = lineItem.dataset.line;
      const input = lineItem.querySelector('.quantity__input');
      let newQuantity;

      if (removeLink) {
        newQuantity = 0;
      } else {
        const currentVal = Number(input.value);
        newQuantity = quantityButton.name === 'plus' ? currentVal + 1 : currentVal - 1;
      }

      if (newQuantity >= 0) {
        if (input) input.value = newQuantity;
        this.debouncedUpdate(line, newQuantity);
      }
    }

    updateQuantity(line, quantity) {
      document.body.classList.add('loading');
      fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ line: line, quantity: quantity })
      })
      .then(response => response.json())
      .then(cartState => {
        pubsub.publish('cart:updated', { source: 'cart-page', cart: cartState });
      })
      .catch(e => console.error(e))
      .finally(() => document.body.classList.remove('loading'));
    }
    
    async renderContents() {
      const res = await fetch('/cart.js');
      const cart = await res.json();
      
      if (!cart) return;

      const form = this.querySelector('form');
      if (!form) return;
      const subtotalEl = form.querySelector('.cart-subtotal-value');

      if (subtotalEl) subtotalEl.textContent = formatMoney(cart.total_price);
      
      if (cart.item_count === 0) {
        window.location.href = '/cart';
        return;
      }

      const container = this.querySelector('.cart-items-container');
      if (!container) {
          console.error('Cart Items Error: The ".cart-items-container" element was not found. Please ensure it exists in your main-cart.liquid file.');
          return;
      }
      
      let itemsHTML = '';
      cart.items.forEach((item, index) => {
        let variantTitleHTML = item.variant_title ? `<div class="pa2 !text-xs mt-1">${item.variant_title}</div>` : '';
        itemsHTML += `
          <div class="cart-item-row flex py-4 border-t border-silver" data-line="${index + 1}">
            <a href="${item.url}" class='block w-1/3 aspect-square'>
              <img src="${item.image}" alt="${item.product_title}" class="object-cover w-full h-full" loading="lazy" />
            </a>
            <div class="flex flex-col w-2/3 pl-3.5 pb-0.5">
              <div class="flex grow justify-between">
                <div>
                  <a href="${item.url}" class="link inline-block font-medium text-[15px] uppercase tracking-wide">${item.product_title}</a>
                  ${variantTitleHTML}
                </div>
                <div class="pl-3 font-medium text-right text-sm uppercase tracking-wider item-price" data-line="${index + 1}">
                  ${formatMoney(item.final_line_price)}
                </div>
              </div>
              <div class="flex shrink justify-between items-end mt-2">
                <div class="quantity">
                  <button type="button" name="minus" class="quantity__button">-</button>
                  <input type="number" class="quantity__input" value="${item.quantity}" readonly>
                  <button type="button" name="plus" class="quantity__button">+</button>
                </div>
                <a href="/cart/change?line=${index + 1}&quantity=0" class="link remove-button">
                  <small class="text-[10px] uppercase tracking-wider">Remove</small>
                </a>
              </div>
            </div>
          </div>`;
      });
      container.innerHTML = itemsHTML;
    }
  });
}

/* =================================================================================
  4. GLOBAL EVENT SUBSCRIPTIONS & INITIALIZATION
================================================================================== */
function handleGlobalCartUpdate(data) {
  const cart = data.cart;
  if (!cart) return;

  const bubbleWrapper = document.getElementById('cart-icon-bubble');
  const bubble = bubbleWrapper ? bubbleWrapper.querySelector('.cart-icon-bubble') : null;
  if (bubble) {
    const bubbleSpan = bubble.querySelector('span[aria-hidden="true"]');
    if (bubbleSpan) bubbleSpan.textContent = cart.item_count;
    bubble.classList.toggle('hidden', cart.item_count === 0);
  }

  // This is now the ONLY part that handles redirection or opening the drawer
  if (data.source === 'product-form') {
    if (CART_TYPE === 'page') {
      if (window.location.pathname !== '/cart') window.location.href = '/cart';
    } else if (CART_TYPE === 'drawer') {
      const drawer = document.querySelector('cart-drawer');
      if (drawer) drawer.open();
    }
  }
}

pubsub.subscribe('cart:updated', handleGlobalCartUpdate);

document.addEventListener('click', (event) => {
    const quantityButton = event.target.closest('.quantity__button');
    if (!quantityButton || !quantityButton.closest('product-form') || quantityButton.closest('cart-items') || quantityButton.closest('cart-drawer')) return;
    
    const container = quantityButton.closest('.quantity');
    const input = container.querySelector('.quantity__input');
    const currentVal = Number(input.value);
    const newQuantity = quantityButton.name === 'plus' ? currentVal + 1 : (currentVal > 1 ? currentVal - 1 : 1);
    input.value = newQuantity;
});

document.addEventListener('DOMContentLoaded', () => {
  const updateButton = document.querySelector('form[action*="/cart"] button[name="update"]');
  if (updateButton) updateButton.style.display = 'none';
});