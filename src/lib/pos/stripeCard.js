// src/lib/pos/stripeCard.js
//
// Stripe's own card box, for card payments that don't touch the reader:
// staff keying a card taken over the phone (Take Payment → Phone card), and
// the customer's /pay/<token> page.
//
// The card number is typed into an iframe Stripe serves and goes straight
// to Stripe — it never passes through our page's code or our server. That is
// the whole reason to use this rather than our own input boxes.

let _stripeJs = null;

function loadStripeJs() {
  if (typeof window === 'undefined') return Promise.reject(new Error('Not in a browser'));
  if (window.Stripe) return Promise.resolve(window.Stripe);
  if (_stripeJs) return _stripeJs;
  _stripeJs = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.async = true;
    s.onload = () => (window.Stripe ? resolve(window.Stripe) : reject(new Error('Stripe did not load')));
    s.onerror = () => { _stripeJs = null; reject(new Error('Could not load the Stripe card box. Check the internet connection.')); };
    document.head.appendChild(s);
  });
  return _stripeJs;
}

/**
 * Mounts the card box into `el` for an existing PaymentIntent.
 * Returns { confirm(), destroy() }. confirm() resolves with the
 * PaymentIntent, or throws with Stripe's plain-language decline message.
 * A declined card can be corrected and confirmed again on the same box —
 * it's the same PaymentIntent, so it can't charge twice.
 */
export async function mountCardBox(el, { publishableKey, clientSecret, wallets = false }) {
  const Stripe = await loadStripeJs();
  const stripe = Stripe(publishableKey);
  const elements = stripe.elements({
    clientSecret,
    appearance: { theme: 'stripe', variables: { colorPrimary: '#c8102e' } },
  });
  const box = elements.create('payment', {
    layout: 'tabs',
    wallets: wallets ? undefined : { applePay: 'never', googlePay: 'never' },
  });
  box.mount(el);

  return {
    async confirm() {
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      });
      if (error) throw new Error(error.message || 'The card was not accepted.');
      return paymentIntent;
    },
    destroy() {
      try { box.destroy(); } catch { /* already gone */ }
    },
  };
}
