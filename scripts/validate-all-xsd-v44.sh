#!/usr/bin/env bash
set -euo pipefail

SCHEMAS_DIR="/opt/facturacion-test/schemas/v4.4"
OUTPUT_DIR="/opt/facturacion-test/output/v4.4"

echo "======================================================================"
echo "   VALIDACIÓN OFICIAL XSD DGT v4.4 CON XMLLINT (LIBXML2)             "
echo "======================================================================"

cd "${SCHEMAS_DIR}"

declare -A TESTS=(
  ["FacturaElectronica_V4.4.xsd"]="*1010000000001*_firmado.xml"
  ["TiqueteElectronico_V4.4.xsd"]="*1040000000002*_firmado.xml"
  ["NotaCreditoElectronica_V4.4.xsd"]="*1030000000003*_firmado.xml"
  ["NotaCreditoElectronica_V4.4.xsd (Ref Histórica v4.3)"]="*1030000000004*_firmado.xml"
  ["NotaDebitoElectronica_V4.4.xsd"]="*1020000000005*_firmado.xml"
)

TOTAL=0
PASSED=0

for item in "FacturaElectronica_V4.4.xsd:*1010000000001*_firmado.xml:Factura Electrónica (01)" \
            "TiqueteElectronico_V4.4.xsd:*1040000000002*_firmado.xml:Tiquete Electrónico (04)" \
            "NotaCreditoElectronica_V4.4.xsd:*1030000000003*_firmado.xml:Nota de Crédito (03)" \
            "NotaCreditoElectronica_V4.4.xsd:*1030000000004*_firmado.xml:Nota de Crédito (03) Ref Histórica v4.3 (Código 16)" \
            "NotaDebitoElectronica_V4.4.xsd:*1020000000005*_firmado.xml:Nota de Débito (02)"; do
  
  IFS=":" read -r schema pattern name <<< "${item}"
  TOTAL=$((TOTAL + 1))
  
  FILE=$(ls ${OUTPUT_DIR}/${pattern} 2>/dev/null | head -n 1)
  if [[ -z "${FILE}" ]]; then
    echo "❌ [ERROR] Archivo no encontrado para patrón ${pattern}"
    continue
  fi

  RESULT=$(xmllint --noout --schema "${schema}" "${FILE}" 2>&1)
  if echo "${RESULT}" | grep -q "validates"; then
    echo "✅ [PASS] ${name} -> ${schema} (${RESULT})"
    PASSED=$((PASSED + 1))
  else
    echo "❌ [FAIL] ${name} -> ${schema}"
    echo "${RESULT}"
  fi
done

echo ""
echo "======================================================================"
echo "RESULTADO: ${PASSED}/${TOTAL} comprobantes v4.4 validados contra XSD oficiales"
echo "======================================================================"
