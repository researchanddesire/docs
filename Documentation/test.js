(function () {
    function addProductsLabel() {
        const buttons = document.querySelectorAll('.nav-dropdown-products-selector-trigger');

        buttons.forEach(button => {
            // Check if label already exists to avoid duplicates
            if (button.previousElementSibling?.classList.contains('products-label')) {
                return;
            }

            // Wrap label and button together to avoid flex gap
            const wrapper = document.createElement('div');
            wrapper.className = 'products-label-wrapper';

            const label = document.createElement('h5');
            label.textContent = 'Products';
            label.className = 'products-label pl-2 mb-3.5 lg:mb-2.5 text-gray-900 dark:text-gray-200 font-medium text-sm';

            button.parentNode.insertBefore(wrapper, button);
            wrapper.appendChild(label);
            wrapper.appendChild(button);
        });
    }

    // Run on initial load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', addProductsLabel);
    } else {
        addProductsLabel();
    }

    // Watch for dynamically added buttons (React portals, etc.)
    const observer = new MutationObserver(addProductsLabel);
    observer.observe(document.body, { childList: true, subtree: true });
})();
