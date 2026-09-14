(function(){
  'use strict';
  if(window.__ARMAZEM_CART_FIXED_MEASURE_POLISH__==='3')return;
  window.__ARMAZEM_CART_FIXED_MEASURE_POLISH__='3';

  function injectStyle(){
    if(document.getElementById('cartFixedMeasurePolishStyle'))return;
    var style=document.createElement('style');
    style.id='cartFixedMeasurePolishStyle';
    style.textContent=`
      .cartItem .fixedMeasureBadge{display:none!important}
      .cartItem .measureClosed.fixedMeasureInline{
        display:block!important;
        margin:3px 0 9px!important;
        padding:0!important;
        border:0!important;
        background:transparent!important;
      }
      .cartItem .measureClosed.fixedMeasureInline .measureSummary{
        display:block!important;
        min-height:0!important;
        margin:0!important;
        padding:0!important;
        border:0!important;
        border-radius:0!important;
        background:transparent!important;
        box-shadow:none!important;
        color:#8a8490!important;
        font-family:"Plus Jakarta Sans",Arial,sans-serif!important;
        font-size:11.5px!important;
        font-weight:600!important;
        line-height:1.35!important;
        white-space:normal!important;
      }
      .cartItem .measureClosed.fixedMeasureInline .measureSummary:before{content:none!important}
      .cartItem .cartInfo>.qtyRow{margin-top:0!important}
      .cartItem .cartInfo>.findHint{margin-top:7px!important}
      @media(max-width:560px){
        .cartItem .measureClosed.fixedMeasureInline{margin:2px 0 8px!important}
        .cartItem .measureClosed.fixedMeasureInline .measureSummary{font-size:10.8px!important;line-height:1.3!important}
      }
    `;
    document.head.appendChild(style);
  }

  injectStyle();
})();
