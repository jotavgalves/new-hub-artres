export const STAGING_CATALOG_VERSION = 9001;
export const STAGING_CONFIG_VERSION = 9001;

export const STAGING_PRODUCT_SNAPSHOT = deepFreeze({
  metadata: {
    schemaVersion: 1,
    mode: 'staging-synthetic',
    catalogVersion: STAGING_CATALOG_VERSION,
    configVersion: STAGING_CONFIG_VERSION,
    loadedByProduction: false
  },
  commercialState: {
    effectiveDiscountPercent: 0,
    campaignActive: false,
    maintenanceActive: false,
    orderSavingEnabled: true,
    productionApiEnabled: false
  },
  products: {
    '50x50': {
      key: '50x50',
      label: 'Bolinhas 50x50 de Teste',
      source: 'staging-synthetic',
      validationStatus: 'staging-only',
      activation: {
        catalogEnabled: true,
        checkoutEnabled: true,
        productionEnabled: false
      },
      pricing: {
        currency: 'BRL',
        unitPrice: 9.75,
        effectiveDiscountPercent: 0,
        campaignActive: false
      },
      quantity: {
        minimum: 6,
        step: 2,
        scope: 'cart-product-total'
      },
      customization: {
        disabled: true
      },
      drives: [{
        id: 'staging-bolinhas',
        productKey: '50x50',
        folderIdConfigured: false
      }]
    }
  }
});

export const STAGING_CATALOG_ITEMS = deepFreeze([
  {
    id: 'staging-artwork-2657',
    driveFileId: 'staging-artwork-2657',
    rootDriveId: 'staging-root-bolinhas',
    parentDriveId: 'staging-theme-1-ano',
    code: '2657-STAGING',
    originalName: '2657-STAGING_1-ANO_50X50.png',
    theme: '1 ANO STAGING',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas 50x50 de Teste',
    sizeKey: '50x50',
    mimeType: 'image/png',
    image: 'https://example.invalid/staging-artwork-2657.png',
    path: 'STAGING/1 ANO/2657-STAGING_1-ANO_50X50.png'
  },
  {
    id: 'staging-artwork-2656',
    driveFileId: 'staging-artwork-2656',
    rootDriveId: 'staging-root-bolinhas',
    parentDriveId: 'staging-theme-1-ano',
    code: '2656-STAGING',
    originalName: '2656-STAGING_1-ANO_50X50.png',
    theme: '1 ANO STAGING',
    subtheme: '',
    productKey: '50x50',
    productName: 'Bolinhas 50x50 de Teste',
    sizeKey: '50x50',
    mimeType: 'image/png',
    image: 'https://example.invalid/staging-artwork-2656.png',
    path: 'STAGING/1 ANO/2656-STAGING_1-ANO_50X50.png'
  }
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
