// Replace with your Cloudflare Worker URL after deploying
const API_BASE = 'https://desiad-ai.wasansharvil.workers.dev';

const form = document.getElementById('ad-form');
const generateBtn = document.getElementById('generateBtn');
const spinner = document.getElementById('spinner');
const outputsSection = document.getElementById('outputs');
const outputFields = ['whatsapp', 'instagram', 'poster_headline', 'hashtags'];

function setLoading(isLoading) {
  if (isLoading) {
    generateBtn.classList.add('loading');
    spinner.style.display = 'inline-block';
    generateBtn.disabled = true;
  } else {
    generateBtn.classList.remove('loading');
    spinner.style.display = 'none';
    generateBtn.disabled = false;
  }
}

function populateOutputs(data) {
  outputsSection.hidden = false;
  outputFields.forEach((field) => {
    const el = document.getElementById(field);
    if (el) el.textContent = data[field] || '';
  });
}

async function copyText(targetId) {
  const el = document.getElementById(targetId);
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.textContent);
    el.dataset.copied = 'true';
    setTimeout(() => delete el.dataset.copied, 1200);
  } catch (err) {
    alert('Copy failed.');
  }
}

function showError(message) {
  outputsSection.hidden = false;
  outputFields.forEach((field) => {
    const el = document.getElementById(field);
    if (el) el.textContent = field === 'whatsapp' ? `Error: ${message}` : '';
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  setLoading(true);

  const payload = {
    businessName: form.businessName.value.trim(),
    businessType: form.businessType.value.trim(),
    city: form.city.value.trim(),
    offer: form.offer.value.trim(),
    language: form.language.value,
    tone: form.tone.value,
  };

  try {
    const resp = await fetch(`${API_BASE}/generate-ad`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();
    if (!resp.ok) {
      showError(data.error || 'Something went wrong');
    } else {
      populateOutputs(data);
    }
  } catch (err) {
    showError('Network error');
  } finally {
    setLoading(false);
  }
});

outputsSection.addEventListener('click', (e) => {
  if (e.target.matches('.copy')) {
    const target = e.target.getAttribute('data-target');
    copyText(target);
  }
});
