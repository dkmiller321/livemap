// The page's own code. It knows nothing about tracing.
const button = document.querySelector('[data-testid="ask-button"]');
const result = document.querySelector('[data-testid="ask-result"]');

button.addEventListener('click', async () => {
  button.disabled = true;
  result.textContent = 'Asking…';
  try {
    const res = await fetch('/hello');
    const body = await res.json();
    result.textContent = res.ok ? body.reply : `Failed: ${res.status}`;
  } catch (err) {
    result.textContent = `Failed: ${err.message}`;
  } finally {
    button.disabled = false;
  }
});
