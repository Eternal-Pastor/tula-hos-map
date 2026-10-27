self.onmessage=function(event){
  const {id,task,payload}=event.data;
  try{
    const A=self.HospitalAccessibility;
    const result=task==='grid'?A.grid(payload.zones,payload.step):task==='complete'?A.completeTimes(payload.cells,payload.destinations,payload.records,payload.services):A.bands(payload.items);
    self.postMessage({id,result});
  }
  catch(error){self.postMessage({id,error:String(error.message||error)});}
};
