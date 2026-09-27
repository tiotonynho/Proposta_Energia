# SolarPro - MVP de orçamentos fotovoltaicos

Protótipo web baseado no modelo de proposta da Pórtico Solar Energy.

## Como executar

Abra `index.html` diretamente no navegador ou execute um servidor local:

```powershell
python -m http.server 8080
```

Depois acesse `http://localhost:8080`.

## O que está implementado

- Cadastro do cliente e da unidade consumidora
- Histórico de consumo de 12 meses
- Dimensionamento automático de potência e módulos
- Estimativa de geração mensal e anual
- Formação de preço baseada no modelo Excel
- Economia e payback simples
- Proposta comercial responsiva
- Impressão ou exportação para PDF pelo navegador

Os dados são mantidos apenas durante a sessão. Banco de dados, autenticação, leitura automática de conta e integração com distribuidoras ficam para as próximas etapas.
