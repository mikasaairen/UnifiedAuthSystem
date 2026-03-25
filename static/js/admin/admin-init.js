/**
 * 入口：DOM 就绪后初始化
 */
document.addEventListener('DOMContentLoaded', async function() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = '/login';
        return;
    }

    await loadCurrentUser();
    
    initNavigation();
    initTabsDropdown();
    initUserSearchDebounce();
    initUserFormInPage();
    // 默认打开概览标签
    openOrActivateTab('overview');
});
