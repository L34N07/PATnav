class InvoiceAuthorizationService {
  constructor({ repository, provider }) {
    this.repository = repository
    this.provider = provider
  }

  buildDryRun(invoiceKey) {
    const invoiceRecord = this.repository.getInvoice(invoiceKey)
    if (!invoiceRecord.venta) {
      throw new Error(
        `No existe la venta ${invoiceRecord.key.tipo} ${invoiceRecord.key.prefijo}-${invoiceRecord.key.numero}.`
      )
    }

    return {
      selectedInvoice: invoiceRecord.key,
      schema: {
        columns: this.repository.getSchemaSummary(),
        indexes: this.repository.getIndexSummary()
      },
      sourceRecords: {
        Ventas: invoiceRecord.venta,
        Cliente: invoiceRecord.cliente,
        CategoriaIva: invoiceRecord.categoriaIva,
        LugarEntrega: invoiceRecord.lugarEntrega,
        Talonario: invoiceRecord.talonario,
        VentasItems: invoiceRecord.items
      },
      authorizationPreview: this.provider.buildAuthorizationPreview(invoiceRecord)
    }
  }
}

module.exports = {
  InvoiceAuthorizationService
}
