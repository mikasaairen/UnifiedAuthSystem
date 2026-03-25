/**
 * 模态框与全局提示
 */
function showModal(title, content, onSubmit) {
    closeModal();
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
        <div class="modal">
            <div class="modal-header">
                <h3>${title}</h3>
                <button type="button" class="modal-close" onclick="closeModal()" aria-label="关闭">&times;</button>
            </div>
            <div class="modal-body">
                ${content}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const form = modal.querySelector('form');
    if (form && onSubmit) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            try {
                await onSubmit(form);
            } catch (error) {
                showMessage('操作失败: ' + error.message, 'error');
            }
        });
    }
}

function closeModal() {
    const modals = document.querySelectorAll('body > .modal-overlay');
    modals.forEach(function (m) { m.remove(); });
}

function showMessage(message, type = 'info', duration = 3000) {
    const msg = document.createElement('div');
    msg.className = 'message message-' + type;
    msg.textContent = message;
    document.body.appendChild(msg);
    
    setTimeout(() => msg.classList.add('show'), 10);
    setTimeout(() => {
        msg.classList.remove('show');
        setTimeout(() => msg.remove(), 300);
    }, duration);
}

document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
        closeModal();
    }
});
