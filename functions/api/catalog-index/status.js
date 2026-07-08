import { baseIndexParams, json, readIndex } from '../_catalog_index.js';

export async function onRequestGet(context){
  try{
    const sampleParams = baseIndexParams(5);
    const sample = await readIndex(context.env, sampleParams);

    const foldersParams = baseIndexParams(1);
    foldersParams.set('type', 'eq.folder');
    const folders = await readIndex(context.env, foldersParams);

    const artworksParams = baseIndexParams(1);
    artworksParams.set('type', 'eq.artwork');
    const artworks = await readIndex(context.env, artworksParams);

    return json({
      ok: true,
      source: 'catalog_index',
      ready: true,
      hasFolders: folders.length > 0,
      hasArtworks: artworks.length > 0,
      sample
    });
  }catch(error){
    return json({ ok:false, ready:false, error:String(error && error.message || error || 'CATALOG_INDEX_STATUS_ERROR') }, 500);
  }
}
