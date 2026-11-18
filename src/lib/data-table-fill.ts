/**
 * Fill-height data tables size their scroll region to the space left in the
 * viewport. The space below the region is reserved for the pagination row and
 * a small bottom inset.
 */
export const DATA_TABLE_FILL_BOTTOM_RESERVE = 96;

/** Attribute on the element sized by fill-height; its value is the minimum height in px. */
export const DATA_TABLE_FILL_ATTRIBUTE = "data-luma-fill-height";

export function dataTableFillHeight(top: number, viewportHeight: number, minHeight: number) {
  return Math.max(minHeight, Math.floor(viewportHeight - top - DATA_TABLE_FILL_BOTTOM_RESERVE));
}

/**
 * Inline script for the root layout. Server HTML can only carry a CSS estimate
 * of the fill height, and the client measurement lands after hydration, so a
 * hard refresh showed the table at one height and then snapped to another.
 * This observer measures each fill-height table as soon as it is attached and
 * visible (including Suspense segments streamed in later) and sets the final
 * height before the browser paints it. Client navigations are handled by the
 * component's layout effect, so the observer stops once the page has loaded.
 */
export const DATA_TABLE_FILL_INIT = `(function(){try{
var A=${JSON.stringify(DATA_TABLE_FILL_ATTRIBUTE)},R=${DATA_TABLE_FILL_BOTTOM_RESERVE};
function fit(){var l=document.querySelectorAll("["+A+"]");for(var i=0;i<l.length;i++){var el=l[i];if(!el.getClientRects().length)continue;var m=Number(el.getAttribute(A))||0;var h=Math.max(m,Math.floor(innerHeight-el.getBoundingClientRect().top-R))+"px";if(el.style.height!==h){el.style.height=h;el.style.maxHeight=h;}}}
var mo=new MutationObserver(fit);mo.observe(document.documentElement,{childList:true,subtree:true});
addEventListener("load",function(){fit();mo.disconnect();});
}catch(e){}})()`;
