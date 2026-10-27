# Menos Tela

App pessoal (PWA) para reduzir o tempo de tela aos poucos.

- **Meta progressiva**: no 1º dia corta metade da distância até a meta final (máx. 2h); depois desce 20, 12 ou 8 min por dia até chegar lá.
- **Manhã, tarde e noite**: a meta do dia é dividida conforme a hora que você acorda e dorme (noite pesa menos, por causa do sono).
- **Avisos**: se você gastar demais num período, o app avisa e recalcula os períodos seguintes.
- Tudo fica salvo só no aparelho (`localStorage`), com backup em JSON nos Ajustes.

## Como usar

O navegador não consegue ler o tempo de tela do sistema, então você copia o total que aparece em
**Bem-estar digital** (Android) ou **Tempo de Uso** (iPhone) e toca em *Atualizar*. A diferença desde a
última leitura vai para o período atual.

## Instalar no celular

Abra o link do GitHub Pages no celular e:

- **Android (Chrome)**: menu ⋮ → *Adicionar à tela inicial* / *Instalar app*.
- **iPhone (Safari)**: botão compartilhar → *Adicionar à Tela de Início*.

## Rodar localmente

```bash
python -m http.server 5173
```
