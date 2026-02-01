/**
 * Navigation Component
 * Renders the top navigation bar with active state handling
 */

function renderNavigation(activePage) {
    const navHtml = `
    <div style="margin-bottom: 40px; padding-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.1); display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
                <span style="font-size: 18px;">🛡️</span>
            </div>
            <a href="/" style="text-decoration: none; color: white;">
                <span style="font-weight: 700; font-size: 1.2rem; letter-spacing: -0.02em;">Shadow<span style="color: #a1a1aa;">Privacy</span></span>
            </a>
        </div>
        
        <nav style="display: flex; gap: 24px;">
            <a href="/" class="nav-link ${activePage === 'dashboard' ? 'active' : ''}">Dashboard</a>
            <a href="/transfer.html" class="nav-link ${activePage === 'demo' ? 'active' : ''}">Private Transfer</a>
            <a href="/explanation.html" class="nav-link ${activePage === 'explanation' ? 'active' : ''}">How it Works</a>
            <a href="/docs.html" class="nav-link ${activePage === 'docs' ? 'active' : ''}">SDK Docs</a>
        </nav>

        <div style="display: flex; gap: 12px;">
            <a href="https://github.com/danielbolsson/Solana-Shadow-Sdk" target="_blank" style="opacity: 0.7; transition: opacity 0.2s; color: white; text-decoration: none; display: flex; align-items: center; gap: 6px; font-size: 0.9rem;">
                <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
                </svg>
                GitHub
            </a>
        </div>
    </div>
    
    <style>
        .nav-link {
            text-decoration: none;
            color: #a1a1aa;
            font-weight: 500;
            font-size: 0.95rem;
            padding: 8px 0;
            position: relative;
            transition: color 0.2s;
        }
        
        .nav-link:hover {
            color: #fafafa;
        }
        
        .nav-link.active {
            color: #10b981;
        }
        
        .nav-link.active::after {
            content: '';
            position: absolute;
            bottom: 0px;
            left: 0;
            width: 100%;
            height: 2px;
            background: #10b981;
            box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
        }
    </style>
    `;

    // Insert at the beginning of body
    document.body.insertAdjacentHTML('afterbegin', navHtml);
}
